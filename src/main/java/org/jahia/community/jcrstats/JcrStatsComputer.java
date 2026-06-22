package org.jahia.community.jcrstats;

import org.apache.commons.io.FileUtils;
import org.apache.jackrabbit.JcrConstants;
import org.apache.jackrabbit.core.fs.FileSystem;
import org.jahia.api.Constants;
import org.jahia.services.content.JCRContentUtils;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRSessionFactory;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.content.JCRTemplate;
import org.jahia.services.content.QueryManagerWrapper;
import org.jahia.services.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;

import javax.jcr.RepositoryException;
import javax.jcr.query.Query;
import java.io.BufferedReader;
import java.io.BufferedWriter;
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
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.atomic.AtomicLong;

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
        return JCRTemplate.getInstance().doExecuteWithSystemSession((JCRSessionWrapper session) -> computeSize(session, path, visited));
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
        writeGraphHeader(graphFile);

        // Fix 4: track whether the data-writing step succeeded; abort upload on failure
        boolean dataWritten = false;
        try (final FileOutputStream fileOutputStream = new FileOutputStream(graphFile, true);
             final OutputStreamWriter outputStreamWriter = new OutputStreamWriter(fileOutputStream, StandardCharsets.UTF_8);
             final BufferedWriter bufferedWriter = new BufferedWriter(outputStreamWriter)) {
            writeGraphNode(nodeStats, bufferedWriter, 0, 0L);
            dataWritten = true;
        } catch (IOException | RepositoryException ex) {
            LOGGER.error("Impossible to write graph", ex);
        }

        // Fix 4: do not upload a partial/corrupt file
        if (!dataWritten) {
            return null;
        }

        writeGraphFooter(graphFile);
        try (final InputStream graphStream = new FileInputStream(graphFile)) {
            final JCRNodeWrapper jcrStatsNode = mkdirs("/sites/systemsite/files/jcr-stats/" + storageFolder);
            jcrStatsNode.uploadFile(FILE_NAME, graphStream, MediaType.TEXT_HTML_VALUE);
            jcrStatsNode.saveSession();
            return jcrStatsNode.getPath() + FileSystem.SEPARATOR + FILE_NAME;
        } catch (IOException | RepositoryException ex) {
            LOGGER.error("Impossible to write graph", ex);
            return null;
        }
    }

    private void writeGraphHeader(File graphFile) {
        // Fix 4: null-check the resource — throws clearly instead of NPE when bundle is mis-packaged
        final URL inputUrl = this.getClass().getClassLoader().getResource("META-INF/templates/flamegraph.header.vm");
        if (inputUrl == null) {
            throw new IllegalStateException("Missing flamegraph template: META-INF/templates/flamegraph.header.vm");
        }
        try {
            FileUtils.copyURLToFile(inputUrl, graphFile);
        } catch (IOException ex) {
            LOGGER.error("Impossible to copy header", ex);
        }
    }

    private void writeGraphFooter(File graphFile) {
        // Fix 4: null-check the resource — throws clearly instead of NPE when bundle is mis-packaged
        final InputStream rawStream = this.getClass().getClassLoader().getResourceAsStream("META-INF/templates/flamegraph.footer.vm");
        if (rawStream == null) {
            throw new IllegalStateException("Missing flamegraph template: META-INF/templates/flamegraph.footer.vm");
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
        } catch (IOException ex) {
            LOGGER.error("Impossible to copy footer", ex);
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

    private NodeStats computeSize(JCRSessionWrapper session, String currentPath, AtomicLong visited) throws RepositoryException {
        session.refresh(false);
        // Defensive cap: abort cleanly before an over-broad path can exhaust the heap. The async
        // service records this as lastError; the synchronous GraphQL path catches it and returns a
        // sentinel (-1 / null). Generous ceiling, so legitimate traversals never hit it.
        if (visited.incrementAndGet() >= MAX_VISITED_NODES) {
            throw new RepositoryException("JCR stats traversal aborted: exceeded the maximum of "
                    + MAX_VISITED_NODES + " visited nodes (path too broad).");
        }
        final NodeStats currentNodeStats = new NodeStats(currentPath);
        final QueryManagerWrapper manager = session.getWorkspace().getQueryManager();
        final String queryStmt = String.format("SELECT * FROM [%s] AS content WHERE ISCHILDNODE(content, '%s')", JcrConstants.NT_BASE, JCRContentUtils.sqlEncode(currentPath));
        final QueryWrapper query = manager.createQuery(queryStmt, Query.JCR_SQL2);
        final JCRNodeIteratorWrapper nodeIterator = query.execute().getNodes();
        final JCRNodeWrapper nodeWrapper = session.getNode(currentPath, false);
        if (nodeWrapper.hasProperty(JcrConstants.JCR_DATA)) {
            currentNodeStats.setSize(nodeWrapper.getProperty(JcrConstants.JCR_DATA).getLength());
        }

        while (nodeIterator.hasNext()) {
            final JCRNodeWrapper subNodeWrapper = (JCRNodeWrapper) nodeIterator.next();
            final NodeStats nodeStats = computeSize(session, subNodeWrapper.getPath(), visited);
            currentNodeStats.addSubNodeStats(nodeStats);
        }

        return currentNodeStats;
    }

    private static JCRNodeWrapper mkdirs(String path) throws RepositoryException {
        final JCRSessionWrapper session = JCRSessionFactory.getInstance().getCurrentSystemSession(Constants.EDIT_WORKSPACE, null, null);
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
