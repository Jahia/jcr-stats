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
import java.text.SimpleDateFormat;
import java.util.Date;

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

    /**
     * Computes the size statistics of the subtree rooted at {@code path} without writing anything.
     * Read-only: safe to call from a GraphQL query.
     */
    public NodeStats computeStats(String path) throws RepositoryException {
        return JCRTemplate.getInstance().doExecuteWithSystemSession((JCRSessionWrapper session) -> computeSize(session, path));
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

    /** Total number of nodes in the subtree, root included. */
    public long countNodes(NodeStats nodeStats) {
        long count = 1L;
        for (NodeStats subNodeStats : nodeStats.getSubNodeStats()) {
            count += countNodes(subNodeStats);
        }
        return count;
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
        } catch (IOException ex) {
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
        final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy/MM/dd/HH/mm/ss");
        final String storageFolder = dateFormat.format(new Date());

        final File graphFile = graphPath.toFile();
        writeGraphHeader(graphFile);
        try (final FileOutputStream fileOutputStream = new FileOutputStream(graphFile, true);
             final OutputStreamWriter outputStreamWriter = new OutputStreamWriter(fileOutputStream, StandardCharsets.UTF_8);
             final BufferedWriter bufferedWriter = new BufferedWriter(outputStreamWriter)) {
            writeGraphNode(nodeStats, bufferedWriter, 0, 0L);
        } catch (IOException | RepositoryException ex) {
            LOGGER.error("Impossible to write graph", ex);
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
        try {
            final URL inputUrl = this.getClass().getClassLoader().getResource("META-INF/templates/flamegraph.header.vm");
            FileUtils.copyURLToFile(inputUrl, graphFile);
        } catch (IOException ex) {
            LOGGER.error("Impossible to copy header", ex);
        }
    }

    private void writeGraphFooter(File graphFile) {
        try (final InputStream inputStream = this.getClass().getClassLoader().getResourceAsStream("META-INF/templates/flamegraph.footer.vm");
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
        final String line = String.format("f(%s,%s,%s,%s,\"%s\")", level, startPosition, nodeStats.getSize(), 0, nodeStats.getName());
        bufferedWriter.write(line);
        bufferedWriter.newLine();
        for (NodeStats subNodeStats : nodeStats.getSubNodeStats()) {
            writeGraphNode(subNodeStats, bufferedWriter, level + 1, startPosition);
            startPosition = startPosition + subNodeStats.getSize();
        }
        bufferedWriter.flush();
    }

    private NodeStats computeSize(JCRSessionWrapper session, String currentPath) throws RepositoryException {
        session.refresh(false);
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
            final NodeStats nodeStats = computeSize(session, subNodeWrapper.getPath());
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
