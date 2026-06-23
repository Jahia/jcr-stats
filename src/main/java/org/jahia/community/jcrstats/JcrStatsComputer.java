package org.jahia.community.jcrstats;

import org.apache.commons.io.FileUtils;
import org.apache.jackrabbit.JcrConstants;
import org.apache.jackrabbit.core.fs.FileSystem;
import org.jahia.api.Constants;
import org.jahia.services.content.JCRContentUtils;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.content.JCRTemplate;
import org.jahia.services.content.QueryManagerWrapper;
import org.jahia.services.query.QueryWrapper;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;

import javax.jcr.RepositoryException;
import javax.jcr.ValueFormatException;
import javax.jcr.query.Query;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;

/**
 * Reusable JCR size-computation engine.
 *
 * <p>This holds the traversal and flamegraph-generation logic that used to live inside
 * {@link ComputeSizeCommand}. It is now shared by the Karaf command, the GraphQL API and the admin
 * UI so the three surfaces stay consistent (DRY) and the logic is unit-testable without a live JCR
 * session.</p>
 */
public class JcrStatsComputer {

    private static final Logger LOGGER = LoggerFactory.getLogger(JcrStatsComputer.class);
    private static final String FILE_NAME = "flamegraph";
    private static final String FILE_EXT = ".html";
    private static final Path TMP_PATH = FileSystems.getDefault().getPath(System.getProperty("java.io.tmpdir"));

    // Fix 5: static final DateTimeFormatter replaces per-call SimpleDateFormat + new Date()
    private static final DateTimeFormatter STORAGE_FOLDER_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy/MM/dd/HH/mm/ss");

    // Fix 7: named constant for the 4th arg (stack-depth sentinel) in the f(...) call
    /** The stack-depth hint passed to the async-profiler flamegraph viewer; always 0 for JCR stats. */
    private static final int FLAMEGRAPH_STACK_DEPTH = 0;

    /**
     * Defensive hard ceiling on the number of nodes a single traversal may visit. Guards against an
     * over-broad path (or a pathological repository) exhausting the heap. The limit is intentionally
     * generous — far beyond any legitimate subtree — so normal computations are unaffected.
     */
    private static final long MAX_VISITED_NODES = 5_000_000L;

    /**
     * Traversal strategy selector. The default ({@code "direct"}) walks the hierarchy with
     * {@link JCRNodeWrapper#getNodes()}, reading each parent's child-node entries straight from the
     * persisted bundle / item-state cache. Setting {@code -DjcrStats.traversal=query} restores the
     * legacy strategy that fired one {@code ISCHILDNODE} JCR-SQL2 query per node (resolved against the
     * Lucene index). The flag exists for A/B benchmarking; direct traversal is faster — it avoids a
     * per-node query parse/plan/index lookup and an extra path resolution — and more accurate, since
     * it reads committed hierarchy state rather than possibly-lagging index state.
     */
    private static final boolean USE_QUERY_TRAVERSAL =
            "query".equalsIgnoreCase(System.getProperty("jcrStats.traversal", "direct"));

    // A fixed JCR content path (a repository node path, not a configurable filesystem/server URI), so
    // S1075 ("get this URI from a customizable parameter") does not apply. Single source of truth for
    // the base location; the snapshots/reports folders derive from it.
    @SuppressWarnings("java:S1075")
    private static final String JCR_STATS_BASE_PATH = "/sites/systemsite/files/jcr-stats";
    /** JCR folder holding the auto-saved JSON execution snapshots (one timestamped file per run). */
    public static final String SNAPSHOTS_PATH = JCR_STATS_BASE_PATH + "/snapshots";
    // The export envelope's format tag — MUST match the SAVE_FORMAT the UI's importer accepts.
    private static final String SNAPSHOT_FORMAT = "jcr-stats-flamegraph";
    // Snapshot tree depth — keep in sync with the MAX_DEPTH coupling documented in CHANGELOG Notes.
    private static final int SNAPSHOT_MAX_DEPTH = 6;
    // Millis included so two snapshots saved in the same second get distinct file names (no overwrite).
    private static final DateTimeFormatter SNAPSHOT_NAME_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH-mm-ss-SSS");
    /** Max accepted size for an externally-supplied snapshot (defends the saveSnapshot path). */
    private static final int MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
    /** Retention cap: at most this many snapshot files are kept; older ones are pruned on write. */
    private static final int MAX_SNAPSHOTS = 50;

    /**
     * Computes the size statistics of the subtree rooted at {@code path} without writing anything.
     * Read-only: safe to call from a GraphQL query.
     */
    public NodeStats computeStats(String path) throws RepositoryException {
        return computeStats(path, new AtomicLong());
    }

    /**
     * Computes the subtree size while incrementing {@code visited} once per node visited, so a
     * long-running computation can report live progress (a JCR tree has no known total up front).
     */
    public NodeStats computeStats(String path, AtomicLong visited) throws RepositoryException {
        return computeStats(path, visited, () -> false);
    }

    /**
     * As {@link #computeStats(String, AtomicLong)}, but cooperatively cancellable: {@code cancelled}
     * is polled at the start of every node so a long-running asynchronous job can be stopped between
     * nodes (never mid-JCR-operation, which could leave the session inconsistent).
     */
    public NodeStats computeStats(String path, AtomicLong visited, BooleanSupplier cancelled) throws RepositoryException {
        return computeStats(path, visited, cancelled, p -> false);
    }

    /**
     * As {@link #computeStats(String, AtomicLong, BooleanSupplier)}, but also skips any node for which
     * {@code excludedPath} returns true (and its whole subtree), so configured exclusions are removed
     * from the totals. The computed root path itself is never skipped — only its descendants.
     */
    public NodeStats computeStats(String path, AtomicLong visited, BooleanSupplier cancelled, Predicate<String> excludedPath) throws RepositoryException {
        return JCRTemplate.getInstance().doExecuteWithSystemSession((JCRSessionWrapper session) -> computeSize(session, path, visited, cancelled, excludedPath));
    }

    /**
     * Computes the subtree size and writes the flamegraph file into the JCR, returning the
     * aggregated result.
     *
     * @param path                the JCR path to compute (defaults to {@code /} when blank)
     * @param deleteTemporaryFile whether to delete the temporary HTML file after upload
     */
    public ComputeResult computeAndWriteFlamegraph(String path, boolean deleteTemporaryFile) throws RepositoryException {
        final String effectivePath = (path == null || path.isEmpty()) ? FileSystem.SEPARATOR : path;
        final NodeStats nodeStats = computeStats(effectivePath);
        final String flamegraphPath = writeGraphFile(nodeStats, deleteTemporaryFile);
        return new ComputeResult(effectivePath, nodeStats.getSize(), countNodes(nodeStats), flamegraphPath);
    }

    /**
     * Total number of nodes in the subtree, root included.
     *
     * <p>Fix 2: delegates to the pre-accumulated {@link NodeStats#getNodeCount()} instead of
     * recursing, reducing the call complexity from O(n²) to O(1).</p>
     */
    public static long countNodes(NodeStats nodeStats) {
        return nodeStats.getNodeCount();
    }

    /** URL prefix under which JCR files in the default (edit) workspace are served by Jahia. */
    public static final String DEFAULT_WORKSPACE_FILES_PREFIX = "/files/" + Constants.EDIT_WORKSPACE;

    /**
     * Builds the browser URL that renders the given flamegraph file (served by the Jahia file
     * servlet), or {@code null} when no flamegraph was written.
     */
    public static String flamegraphUrl(String flamegraphPath) {
        return flamegraphPath == null ? null : DEFAULT_WORKSPACE_FILES_PREFIX + flamegraphPath;
    }

    private String writeGraphFile(NodeStats nodeStats, boolean deleteTemporaryFile) {
        Path graphPath = null;
        try {
            graphPath = Files.createTempFile(TMP_PATH, FILE_NAME, FILE_EXT);
            return writeGraphData(nodeStats, graphPath);
        } catch (IOException | IllegalStateException ex) {
            // IllegalStateException: a mis-packaged bundle (missing flamegraph template) — log and
            // return null like every other failure path here, rather than escaping the public API.
            LOGGER.error("Impossible to create graph file", ex);
            return null;
        } finally {
            if (deleteTemporaryFile && graphPath != null) {
                try {
                    Files.deleteIfExists(graphPath);
                } catch (IOException ex) {
                    LOGGER.error("Impossible to delete temporary file", ex);
                }
            }
        }
    }

    private String writeGraphData(NodeStats nodeStats, Path graphPath) {
        // Fix 5: use DateTimeFormatter + LocalDateTime instead of SimpleDateFormat + new Date()
        final String storageFolder = STORAGE_FOLDER_FORMATTER.format(LocalDateTime.now());

        final File graphFile = graphPath.toFile();
        // Fix 8: header/footer now signal failure; a half-written file must never be uploaded.
        if (!writeGraphHeader(graphFile)) {
            return null;
        }

        boolean dataWritten = false;
        try (final FileOutputStream fileOutputStream = new FileOutputStream(graphFile, true);
             final OutputStreamWriter outputStreamWriter = new OutputStreamWriter(fileOutputStream, StandardCharsets.UTF_8);
             final BufferedWriter bufferedWriter = new BufferedWriter(outputStreamWriter)) {
            writeGraphNode(nodeStats, bufferedWriter, 0, 0L);
            dataWritten = true;
        } catch (IOException | RepositoryException ex) {
            LOGGER.error("Impossible to write graph", ex);
        }

        // Fix 4/8: do not upload a partial/corrupt file
        if (!dataWritten || !writeGraphFooter(graphFile)) {
            return null;
        }

        // Fix 4: upload inside a dedicated, properly-closed system session (JCRTemplate) instead of the
        // thread-unbound getCurrentSystemSession(), which is unsafe from the background thread.
        try {
            return JCRTemplate.getInstance().doExecuteWithSystemSession((JCRSessionWrapper session) -> {
                try (final InputStream graphStream = new FileInputStream(graphFile)) {
                    final JCRNodeWrapper jcrStatsNode = mkdirs(session, JCR_STATS_BASE_PATH + "/" + storageFolder);
                    jcrStatsNode.uploadFile(FILE_NAME, graphStream, MediaType.TEXT_HTML_VALUE);
                    session.save();
                    return jcrStatsNode.getPath() + FileSystem.SEPARATOR + FILE_NAME;
                } catch (IOException ex) {
                    throw new RepositoryException("Impossible to read graph file for upload", ex);
                }
            });
        } catch (RepositoryException ex) {
            LOGGER.error("Impossible to write graph", ex);
            return null;
        }
    }

    /** Writes the flamegraph HTML header into {@code graphFile}; returns {@code false} on any failure. */
    private boolean writeGraphHeader(File graphFile) {
        final URL inputUrl = this.getClass().getClassLoader().getResource("META-INF/templates/flamegraph.header.vm");
        if (inputUrl == null) {
            LOGGER.error("Missing flamegraph template: META-INF/templates/flamegraph.header.vm");
            return false;
        }
        try {
            FileUtils.copyURLToFile(inputUrl, graphFile);
            return true;
        } catch (IOException ex) {
            LOGGER.error("Impossible to copy header", ex);
            return false;
        }
    }

    /** Appends the flamegraph HTML footer to {@code graphFile}; returns {@code false} on any failure. */
    private boolean writeGraphFooter(File graphFile) {
        final InputStream rawStream = this.getClass().getClassLoader().getResourceAsStream("META-INF/templates/flamegraph.footer.vm");
        if (rawStream == null) {
            LOGGER.error("Missing flamegraph template: META-INF/templates/flamegraph.footer.vm");
            return false;
        }
        try (final InputStream inputStream = rawStream;
             final InputStreamReader inputStreamReader = new InputStreamReader(inputStream, StandardCharsets.UTF_8);
             final BufferedReader bufferedReader = new BufferedReader(inputStreamReader);
             final FileOutputStream fileOutputStream = new FileOutputStream(graphFile, true);
             final OutputStreamWriter outputStreamWriter = new OutputStreamWriter(fileOutputStream, StandardCharsets.UTF_8);
             final BufferedWriter bufferedWriter = new BufferedWriter(outputStreamWriter)) {

            String line;
            while ((line = bufferedReader.readLine()) != null) {
                bufferedWriter.write(line);
                bufferedWriter.newLine();
            }
            return true;
        } catch (IOException ex) {
            LOGGER.error("Impossible to copy footer", ex);
            return false;
        }
    }

    /**
     * Recursively writes one flamegraph data line per node.
     * Package-private to allow unit testing without a live JCR session.
     */
    void writeGraphNode(NodeStats nodeStats, BufferedWriter bufferedWriter, int level, long startPosition) throws RepositoryException, IOException {
        if (LOGGER.isDebugEnabled()) {
            // Guarded: byteCountToDisplaySize() is evaluated eagerly regardless of log level (Sonar S2629).
            LOGGER.debug("Node {}: {}", nodeStats.getPath(), FileUtils.byteCountToDisplaySize(nodeStats.getSize()));
        }
        // Fix 1: JS-escape the node name to prevent stored XSS (Sonar java:S5131).
        // Fix 7: use named constant FLAMEGRAPH_STACK_DEPTH for the 4th arg.
        final String line = String.format("f(%s,%s,%s,%s,\"%s\")",
                level, startPosition, nodeStats.getSize(), FLAMEGRAPH_STACK_DEPTH,
                jsEscape(nodeStats.getName()));
        bufferedWriter.write(line);
        bufferedWriter.newLine();
        for (NodeStats subNodeStats : nodeStats.getSubNodeStats()) {
            writeGraphNode(subNodeStats, bufferedWriter, level + 1, startPosition);
            startPosition = startPosition + subNodeStats.getSize();
        }
        // Fix 6: removed per-node flush(); the try-with-resources close() handles it once.
    }

    /**
     * Escapes a string for safe embedding inside a JavaScript double-quoted string literal.
     *
     * <p>Characters that could break out of the string or inject script are replaced with their
     * Unicode escape sequences (backslash-uXXXX) or conventional JS backslash forms, which are
     * inert in any JS engine and preserve the original display text in the flamegraph viewer.</p>
     *
     * <p>Escapes: backslash, double-quote, {@code <}, {@code >}, {@code /},
     * CR, LF, U+2028 (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR).</p>
     */
    // Package-private (was private) so XSS-escaping behaviour can be unit-tested directly.
    static String jsEscape(String value) {
        if (value == null) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            final char c = value.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"':    sb.append("\\\""); break;
                case '<':    sb.append("\\u003C"); break;
                case '>':    sb.append("\\u003E"); break;
                case '/':    sb.append("\\u002F"); break;
                case '\r':  sb.append("\\u000D"); break;
                case '\n':  sb.append("\\u000A"); break;
                default:
                    // U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR terminate JS lines.
                    // S1905: compare the char directly (char literals) instead of casting to int.
                    if (c == '\u2028') {
                        sb.append("\\u2028");
                    } else if (c == '\u2029') {
                        sb.append("\\u2029");
                    } else {
                        sb.append(c);
                    }
                    break;
            }
        }
        return sb.toString();
    }

    /**
     * Serializes the (depth-limited) tree to JSON and stores it as a timestamped {@code jnt:file}
     * under {@link #SNAPSHOTS_PATH}, so a past execution can be reloaded into the viewer later. The
     * envelope matches the UI's Save/Load format, so {@code jcrStats.snapshot} content loads through
     * the same importer. Returns the stored JCR path, or {@code null} on failure (logged, never thrown
     * — snapshotting must not fail the computation).
     */
    public String writeJsonSnapshot(NodeStats tree, String computedPath) {
        return storeSnapshot(buildSnapshotJson(tree, computedPath));
    }

    /**
     * Stores an externally-supplied snapshot JSON (e.g. a file loaded in the UI) alongside the
     * auto-saved ones, so loaded data joins the saved-executions history. Validates size and that it
     * is a recognized jcr-stats envelope (the UI re-validates the full structure on load). Returns the
     * stored JCR path, or {@code null} if rejected/failed.
     */
    public String saveSnapshot(String json) {
        if (json == null || json.isEmpty() || json.length() > MAX_SNAPSHOT_BYTES) {
            LOGGER.warn("Rejected snapshot save: empty or larger than {} bytes", MAX_SNAPSHOT_BYTES);
            return null;
        }
        if (!isValidSnapshotEnvelope(json)) {
            LOGGER.warn("Rejected snapshot save: not a recognized jcr-stats snapshot envelope");
            return null;
        }
        return storeSnapshot(json);
    }

    /**
     * Structural validation of an externally-supplied snapshot: it must parse as a JSON object whose
     * top-level {@code format} equals {@value #SNAPSHOT_FORMAT} and that carries a {@code tree} object.
     * A real parse (rather than a substring match) rejects malformed or disguised payloads.
     */
    private static boolean isValidSnapshotEnvelope(String json) {
        try {
            final JSONObject root = new JSONObject(json);
            return SNAPSHOT_FORMAT.equals(root.optString("format", null))
                    && root.optJSONObject("tree") != null;
        } catch (JSONException e) {
            return false;
        }
    }

    /** Uploads the given snapshot JSON as a new timestamped {@code jnt:file} under {@link #SNAPSHOTS_PATH}. */
    private String storeSnapshot(String json) {
        final String fileName = "jcr-stats-" + SNAPSHOT_NAME_FORMATTER.format(LocalDateTime.now()) + ".json";
        try {
            // Fix 4: dedicated, properly-closed system session via JCRTemplate (not getCurrentSystemSession).
            return JCRTemplate.getInstance().doExecuteWithSystemSession((JCRSessionWrapper session) -> {
                try (InputStream in = new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8))) {
                    final JCRNodeWrapper folder = mkdirs(session, SNAPSHOTS_PATH);
                    folder.uploadFile(fileName, in, MediaType.APPLICATION_JSON_VALUE);
                    session.save();
                    final String storedPath = folder.getPath() + FileSystem.SEPARATOR + fileName;
                    LOGGER.info("Saved JSON snapshot to {}", storedPath);
                    // Best-effort retention: prune the oldest snapshots beyond the cap. Re-fetch the
                    // folder fresh from the now-saved session rather than reusing the pre-save
                    // reference, which may be stale after the upload/save.
                    pruneOldSnapshots(session);
                    return storedPath;
                } catch (IOException e) {
                    throw new RepositoryException("Failed to serialize JSON snapshot", e);
                }
            });
        } catch (RepositoryException e) {
            LOGGER.error("Failed to write JSON snapshot", e);
            return null;
        }
    }

    /**
     * Best-effort retention: keeps at most {@link #MAX_SNAPSHOTS} most recent snapshot files under
     * {@link #SNAPSHOTS_PATH}, removing the oldest beyond that cap. Failures are logged, never thrown —
     * pruning must not fail a successful save.
     *
     * <p>The snapshots folder is re-fetched fresh from {@code session} (which has already been saved by
     * the caller) rather than reusing a {@link JCRNodeWrapper} obtained before {@code save()}, which
     * could be a stale reference. Still runs inside the caller's {@code doExecuteWithSystemSession}.</p>
     */
    private void pruneOldSnapshots(JCRSessionWrapper session) {
        try {
            final JCRNodeWrapper folder = session.getNode(SNAPSHOTS_PATH);
            final List<JCRNodeWrapper> files = new ArrayList<>();
            final JCRNodeIteratorWrapper it = folder.getNodes();
            while (it.hasNext()) {
                files.add((JCRNodeWrapper) it.next());
            }
            if (files.size() <= MAX_SNAPSHOTS) {
                return;
            }
            // Oldest first (name encodes an ISO-like timestamp, so lexical order == chronological order).
            files.sort(Comparator.comparing(JCRNodeWrapper::getName));
            for (int i = 0; i < files.size() - MAX_SNAPSHOTS; i++) {
                final JCRNodeWrapper old = files.get(i);
                LOGGER.info("Pruning old JCR stats snapshot {}", old.getPath());
                old.remove();
            }
            session.save();
        } catch (RepositoryException | RuntimeException e) {
            LOGGER.warn("Failed to prune old JCR stats snapshots: {}", e.toString());
        }
    }

    /**
     * Deletes a snapshot file at {@code path}. The path MUST be a file directly under
     * {@link #SNAPSHOTS_PATH} — any other path is rejected, so this can never delete arbitrary content.
     * Returns {@code true} if a node was found and removed.
     */
    public boolean deleteSnapshot(String path) {
        if (!isSnapshotPath(path)) {
            LOGGER.warn("Rejected snapshot deletion: {} is not under {}", path, SNAPSHOTS_PATH);
            return false;
        }
        try {
            return Boolean.TRUE.equals(JCRTemplate.getInstance().doExecuteWithSystemSession((JCRSessionWrapper session) -> {
                if (!session.nodeExists(path)) {
                    return Boolean.FALSE;
                }
                session.getNode(path).remove();
                session.save();
                LOGGER.info("Deleted JCR stats snapshot {}", path);
                return Boolean.TRUE;
            }));
        } catch (RepositoryException e) {
            LOGGER.error("Failed to delete JCR stats snapshot {}", path, e);
            return false;
        }
    }

    /** Whether {@code path} is a direct child file of {@link #SNAPSHOTS_PATH} (no nesting, no traversal). */
    static boolean isSnapshotPath(String path) {
        if (path == null) {
            return false;
        }
        final String prefix = SNAPSHOTS_PATH + "/";
        if (!path.startsWith(prefix) || path.contains("..")) {
            return false;
        }
        // A single remaining segment after the prefix — reject any further nesting.
        final String remainder = path.substring(prefix.length());
        return !remainder.isEmpty() && remainder.indexOf('/') < 0;
    }

    /** Builds the export-envelope JSON ({@code {format,version,path,maxDepth,exportedAt,tree}}). */
    static String buildSnapshotJson(NodeStats tree, String computedPath) {
        final StringBuilder sb = new StringBuilder(1024);
        sb.append("{\"format\":\"").append(SNAPSHOT_FORMAT)
                .append("\",\"version\":1,\"path\":\"").append(jsonEscape(computedPath))
                .append("\",\"maxDepth\":").append(SNAPSHOT_MAX_DEPTH)
                // Instant.now() yields an unambiguous UTC instant with a trailing Z, unlike the
                // zone-less LocalDateTime.now() which could be read as any timezone.
                .append(",\"exportedAt\":\"").append(Instant.now()).append("\",\"tree\":");
        appendNodeJson(tree, sb, SNAPSHOT_MAX_DEPTH);
        sb.append('}');
        return sb.toString();
    }

    private static void appendNodeJson(NodeStats node, StringBuilder sb, int remainingDepth) {
        sb.append("{\"name\":\"").append(jsonEscape(node.getName()))
                .append("\",\"path\":\"").append(jsonEscape(node.getPath()))
                .append("\",\"size\":").append(node.getSize())
                .append(",\"nodeCount\":").append(node.getNodeCount())
                .append(",\"children\":[");
        if (remainingDepth > 0) {
            boolean first = true;
            for (NodeStats child : node.getSubNodeStats()) {
                if (!first) {
                    sb.append(',');
                }
                appendNodeJson(child, sb, remainingDepth - 1);
                first = false;
            }
        }
        sb.append("]}");
    }

    /** Escapes a string for embedding in a JSON double-quoted value (RFC 8259). */
    static String jsonEscape(String value) {
        if (value == null) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            final char c = value.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    // Escape C0 controls and lone UTF-16 surrogates (U+D800..U+DFFF). A surrogate that
                    // is not part of a valid pair would otherwise produce invalid UTF-8/JSON on write.
                    if (c < 0x20 || (c >= Character.MIN_SURROGATE && c <= Character.MAX_SURROGATE)) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                    break;
            }
        }
        return sb.toString();
    }

    private NodeStats computeSize(JCRSessionWrapper session, String currentPath, AtomicLong visited, BooleanSupplier cancelled, Predicate<String> excludedPath) throws RepositoryException {
        // Refresh once at the entry rather than once per node: a read-only traversal does not need to
        // re-sync the session view at every level, and per-node refresh was needless overhead.
        session.refresh(false);
        final JCRNodeWrapper root = session.getNode(currentPath, false);
        return computeNode(session, root, visited, cancelled, excludedPath);
    }

    /**
     * Recursively aggregates the size and node count of the subtree rooted at {@code node}.
     *
     * <p>Children are obtained either by direct {@link JCRNodeWrapper#getNodes()} hierarchy iteration
     * (default) or, when {@link #USE_QUERY_TRAVERSAL} is set, by a per-node {@code ISCHILDNODE} query.
     * Both branches recurse on the child {@link JCRNodeWrapper} directly, so no child is re-resolved
     * by path.</p>
     *
     * <p>Package-private to allow unit-testing the traversal/aggregation logic with mocked nodes,
     * without a live JCR session.</p>
     */
    NodeStats computeNode(JCRSessionWrapper session, JCRNodeWrapper node, AtomicLong visited, BooleanSupplier cancelled, Predicate<String> excludedPath) throws RepositoryException {
        // Cooperative cancellation: checked at the start of every node so an async job stops between
        // nodes (never mid-JCR-operation). Distinct exception so the per-branch handlers re-throw it.
        if (cancelled.getAsBoolean()) {
            throw new CancelledException();
        }
        // Defensive cap: abort cleanly before an over-broad path can exhaust the heap. The async
        // service records this as lastError; the synchronous GraphQL path catches it and returns a
        // sentinel (-1 / null). Generous ceiling, so legitimate traversals never hit it.
        if (visited.incrementAndGet() >= MAX_VISITED_NODES) {
            throw new TraversalLimitException("JCR stats traversal aborted: exceeded the maximum of "
                    + MAX_VISITED_NODES + " visited nodes (path too broad).");
        }
        final NodeStats currentNodeStats = new NodeStats(node.getPath());
        if (node.hasProperty(JcrConstants.JCR_DATA)) {
            try {
                // getLength() throws ValueFormatException on a multi-valued jcr:data property; such a
                // node is not a binary we can size, so skip its size contribution rather than abort.
                currentNodeStats.setSize(node.getProperty(JcrConstants.JCR_DATA).getLength());
            } catch (ValueFormatException e) {
                LOGGER.warn("Skipping size of {} — jcr:data is multi-valued: {}", currentNodeStats.getPath(), e.toString());
            }
        }

        final JCRNodeIteratorWrapper children = listChildren(session, node, currentNodeStats.getPath());
        if (children == null) {
            return currentNodeStats; // children could not be enumerated; already logged
        }
        // S135: at most one branch-altering statement in this loop. nextChild() absorbs the
        // hasNext()/next() iteration (returning null to end the loop, on exhaustion or iteration
        // error); the per-child error handling is delegated to accumulateChild().
        for (JCRNodeWrapper child = nextChild(children, currentNodeStats.getPath());
             child != null;
             child = nextChild(children, currentNodeStats.getPath())) {
            accumulateChild(session, child, currentNodeStats, visited, cancelled, excludedPath);
        }

        return currentNodeStats;
    }

    /**
     * Returns the next child from {@code children}, or {@code null} when iteration is finished — either
     * because the iterator is exhausted or because {@code hasNext()}/{@code next()} threw (Jahia wraps
     * repository errors as unchecked). A {@code null} return ends the children loop in {@link #computeNode}.
     */
    private JCRNodeWrapper nextChild(JCRNodeIteratorWrapper children, String parentPath) {
        try {
            return children.hasNext() ? (JCRNodeWrapper) children.next() : null;
        } catch (RuntimeException e) {
            LOGGER.warn("Stopped listing children of {} after an iteration error: {}", parentPath, e.toString());
            return null;
        }
    }

    /**
     * Recurses into one child and adds its stats to {@code parentStats}, unless the child is excluded.
     * A {@link TraversalAbortException} (cancellation or the hard node limit) propagates to abort the
     * whole traversal; any other per-child error is logged and skipped so a single bad branch does not
     * fail the computation.
     */
    private void accumulateChild(JCRSessionWrapper session, JCRNodeWrapper child, NodeStats parentStats,
            AtomicLong visited, BooleanSupplier cancelled, Predicate<String> excludedPath) throws RepositoryException {
        try {
            // Configured exclusions remove the node and its whole subtree from the totals.
            if (!excludedPath.test(child.getPath())) {
                parentStats.addSubNodeStats(computeNode(session, child, visited, cancelled, excludedPath));
            }
        } catch (TraversalAbortException e) {
            throw e; // cancellation or the hard MAX_VISITED_NODES limit — abort the whole traversal
        } catch (RepositoryException | RuntimeException e) {
            LOGGER.warn("Skipping a child of {} — could not compute its size: {}",
                    parentStats.getPath(), e.toString());
        }
    }

    /**
     * Lists the children of {@code node}, or returns {@code null} if they cannot be enumerated at all.
     *
     * <p>The default strategy is direct {@link JCRNodeWrapper#getNodes()}. That call builds every child
     * eagerly, so a single child whose name is not a valid JCR path — e.g. an external data-source node
     * named with an ISO-8601 timestamp, where {@code ':'} is the namespace-prefix separator — aborts the
     * whole listing with {@code MalformedPathException}. When that happens we fall back to an
     * {@code ISCHILDNODE} query whose path argument is escaped via {@link JCRContentUtils#sqlEncode}: the
     * index returns the valid children one by one (the un-representable node is simply absent), so the
     * rest of the branch is recovered instead of dropped. Only if the escaped query also fails do we give
     * up on this node's children (logged, returns {@code null}).</p>
     */
    private JCRNodeIteratorWrapper listChildren(JCRSessionWrapper session, JCRNodeWrapper node, String path) {
        if (!USE_QUERY_TRAVERSAL) {
            try {
                return node.getNodes();
            } catch (RepositoryException | RuntimeException e) {
                LOGGER.warn("Direct child listing of {} failed ({}); retrying via escaped ISCHILDNODE query",
                        path, e.toString());
            }
        }
        try {
            return queryChildren(session, path);
        } catch (RepositoryException | RuntimeException e) {
            LOGGER.warn("Skipping children of {} — could not enumerate them (likely an invalid node name "
                    + "from an external provider): {}", path, e.toString());
            return null;
        }
    }

    /**
     * Base type for the conditions that must abort the WHOLE traversal — cancellation and the
     * {@link #MAX_VISITED_NODES} cap. The best-effort error handlers in {@link #computeNode} re-throw
     * this (rather than treating it as a skippable bad branch), so it propagates to the caller.
     */
    private abstract static class TraversalAbortException extends RepositoryException {
        private static final long serialVersionUID = 1L;

        TraversalAbortException(String message) {
            super(message);
        }
    }

    /** Signals that {@link #MAX_VISITED_NODES} was reached. */
    private static final class TraversalLimitException extends TraversalAbortException {
        private static final long serialVersionUID = 1L;

        TraversalLimitException(String message) {
            super(message);
        }
    }

    /**
     * Signals that the caller requested cancellation (via the {@code cancelled} supplier).
     * Package-private (not nested-private) so {@link JcrStatsService} can distinguish a clean
     * cancellation from a genuine post-cancel {@link RepositoryException} by exception type.
     */
    static final class CancelledException extends TraversalAbortException {
        private static final long serialVersionUID = 1L;

        CancelledException() {
            super("JCR stats traversal cancelled.");
        }
    }

    /** Legacy strategy: returns the direct children of {@code path} via an {@code ISCHILDNODE} query. */
    private JCRNodeIteratorWrapper queryChildren(JCRSessionWrapper session, String path) throws RepositoryException {
        final QueryManagerWrapper manager = session.getWorkspace().getQueryManager();
        final String queryStmt = String.format("SELECT * FROM [%s] AS content WHERE ISCHILDNODE(content, '%s')",
                JcrConstants.NT_BASE, JCRContentUtils.sqlEncode(path));
        final QueryWrapper query = manager.createQuery(queryStmt, Query.JCR_SQL2);
        return query.execute().getNodes();
    }

    private static JCRNodeWrapper mkdirs(JCRSessionWrapper session, String path) throws RepositoryException {
        JCRNodeWrapper folderNode = session.getRootNode();
        for (String folder : path.split(FileSystem.SEPARATOR)) {
            if (!folder.isEmpty()) {
                if (folderNode.hasNode(folder)) {
                    folderNode = folderNode.getNode(folder);
                } else {
                    folderNode = folderNode.addNode(folder, "jnt:folder");
                }
            }
        }
        return folderNode;
    }
}
