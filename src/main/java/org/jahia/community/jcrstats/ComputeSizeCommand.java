package org.jahia.community.jcrstats;

import org.apache.commons.io.FileUtils;
import org.apache.jackrabbit.JcrConstants;
import org.apache.jackrabbit.core.fs.FileSystem;
import org.apache.karaf.shell.api.action.Action;
import org.apache.karaf.shell.api.action.Command;
import org.apache.karaf.shell.api.action.Option;
import org.apache.karaf.shell.api.action.lifecycle.Service;
import org.jahia.api.Constants;
import org.jahia.services.content.*;
import org.jahia.services.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;

import javax.jcr.RepositoryException;
import javax.jcr.query.Query;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.SimpleDateFormat;
import java.util.Date;

@Command(scope = "jcr-stats", name = "compute-size", description = "Compute size")
@Service
public class ComputeSizeCommand implements Action {

    private static final Logger LOGGER = LoggerFactory.getLogger(ComputeSizeCommand.class);
    private static final String FILE_NAME = "flamegraph";
    private static final String FILE_EXT = ".html";
    private static final Path TMP_PATH = FileSystems.getDefault().getPath(System.getProperty("java.io.tmpdir"));

    @Option(name = "-p", aliases = "--path", description = "Path to compute")
    private String path = "/";

    @Option(name = "-d", aliases = "--delete-temporary-file", description = "Delete temporary file")
    private boolean deleteTemporaryFile = false;

    @Override
    public Object execute() throws RepositoryException {
        final NodeStats nodeStats = JCRTemplate.getInstance().doExecuteWithSystemSession((JCRSessionWrapper session) -> computeSize(session, path));
        writeGraphFile(nodeStats);
        return null;
    }

    public void writeGraphFile(NodeStats nodeStats) {
        Path graphPath = null;
        try {
            graphPath = Files.createTempFile(TMP_PATH, FILE_NAME, FILE_EXT);
            writeGraphData(nodeStats, graphPath);
        } catch (IOException ex) {
            LOGGER.error("Impossible to create graph file", ex);
        } finally {
            if (deleteTemporaryFile) {
                try {
                    Files.deleteIfExists(graphPath);
                } catch (IOException ex) {
                    LOGGER.error("Impossible to delete temporary file", ex);
                }
            }
        }
    }

    private void writeGraphData(NodeStats nodeStats, Path graphPath) {
        final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy/MM/dd/HH/mm/ss");
        final String storageFolder = dateFormat.format(new Date());

        final File graphFile = graphPath.toFile();
        try (final InputStream graphStream = new FileInputStream(graphFile); final FileWriter fileWriter = new FileWriter(graphFile, true); final BufferedWriter bufferedWriter = new BufferedWriter(fileWriter);) {
            writeGraphHeader(graphFile);
            writeGraphData(nodeStats, bufferedWriter, 0, 0L);
            writeGraphFooter(graphFile);
            final JCRNodeWrapper jcrStatsNode = mkdirs("/sites/systemsite/files/jcr-stats/" + storageFolder);
            jcrStatsNode.uploadFile(FILE_NAME, graphStream, MediaType.TEXT_HTML_VALUE);
            jcrStatsNode.saveSession();
        } catch (IOException | RepositoryException ex) {
            LOGGER.error("Impossible to write graph", ex);
        }
    }

    public void writeGraphHeader(File graphFile) {
        try {
            final URL inputUrl = this.getClass().getClassLoader().getResource("META-INF/templates/flamegraph.header.vm");
            FileUtils.copyURLToFile(inputUrl, graphFile);
        } catch (IOException ex) {
            LOGGER.error("Impossible to copy header", ex);
        }
    }

    public void writeGraphFooter(File graphFile) {
        try (final InputStream inputStream = this.getClass().getClassLoader().getResourceAsStream("META-INF/templates/flamegraph.footer.vm"); final InputStreamReader inputStreamReader = new InputStreamReader(inputStream, StandardCharsets.UTF_8); final BufferedReader bufferedReader = new BufferedReader(inputStreamReader); final FileWriter fileWriter = new FileWriter(graphFile, true); final BufferedWriter bufferedWriter = new BufferedWriter(fileWriter)) {

            String line;

            while ((line = bufferedReader.readLine()) != null) {
                bufferedWriter.write(line);
                bufferedWriter.newLine();
            }

        } catch (IOException ex) {
            LOGGER.error("Impossible to copy footer", ex);
        }
    }

    public void writeGraphData(NodeStats nodeStats, BufferedWriter bufferedWriter, int level, Long startPosition) throws RepositoryException, IOException {
        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug(String.format("Node %s: %s", nodeStats.getPath(), FileUtils.byteCountToDisplaySize(nodeStats.getSize())));
        }
        final String line = String.format("f(%s,%s,%s,%s,\"%s\")", level, startPosition, nodeStats.getSize(), 0, nodeStats.getName());
        bufferedWriter.write(line);
        bufferedWriter.newLine();
        for (NodeStats subNodeStats : nodeStats.getSubNodeStats()) {
            writeGraphData(subNodeStats, bufferedWriter, level + 1, startPosition);
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
