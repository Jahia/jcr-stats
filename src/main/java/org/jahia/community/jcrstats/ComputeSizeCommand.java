package org.jahia.community.jcrstats;

import org.apache.commons.io.FileUtils;
import org.apache.karaf.shell.api.action.Action;
import org.apache.karaf.shell.api.action.Command;
import org.apache.karaf.shell.api.action.Option;
import org.apache.karaf.shell.api.action.lifecycle.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;

/**
 * Karaf shell command {@code jcr-stats:compute-size}.
 *
 * <p>Thin entry point that delegates to {@link JcrStatsComputer}; the same engine backs the GraphQL
 * API and the admin UI so all three surfaces behave identically.</p>
 */
@Command(scope = "jcr-stats", name = "compute-size", description = "Compute size")
@Service
public class ComputeSizeCommand implements Action {

    private static final Logger LOGGER = LoggerFactory.getLogger(ComputeSizeCommand.class);

    @Option(name = "-p", aliases = "--path", description = "Path to compute")
    private String path = "/";

    @Option(name = "-d", aliases = "--delete-temporary-file", description = "Delete temporary file")
    private boolean deleteTemporaryFile = false;

    @Override
    public Object execute() throws RepositoryException {
        final ComputeResult result = new JcrStatsComputer().computeAndWriteFlamegraph(path, deleteTemporaryFile);
        LOGGER.info("Computed {} node(s) under {} totalling {} (flamegraph: {})",
                result.getNodeCount(), result.getPath(),
                FileUtils.byteCountToDisplaySize(result.getTotalSize()), result.getFlamegraphPath());
        return null;
    }
}
