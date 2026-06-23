package org.jahia.community.jcrstats.graphql;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import org.jahia.community.jcrstats.JcrStatsComputer;
import org.jahia.community.jcrstats.JcrStatsConfig;
import org.jahia.community.jcrstats.JcrStatsService;
import org.jahia.community.jcrstats.NodeStats;
import org.jahia.modules.graphql.provider.dxm.security.GraphQLRequiresPermission;
import org.jahia.services.content.JCRContentUtils;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRTemplate;
import org.jahia.osgi.BundleUtils;
import org.jahia.services.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import javax.jcr.query.Query;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@GraphQLName("JcrStatsQuery")
@GraphQLDescription("JCR Stats queries")
public class JcrStatsQuery {

    private static final Logger LOGGER = LoggerFactory.getLogger(JcrStatsQuery.class);
    private static final String DEFAULT_PATH = "/";
    private static final String REPORTS_BASE_PATH = "/sites/systemsite/files/jcr-stats";
    private static final int DEFAULT_MAX_DEPTH = 6;

    @GraphQLField
    @GraphQLName("size")
    @GraphQLDescription("Returns the aggregated size in bytes of the subtree at the given path (read-only). Returns -1 on error.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Long size(
            @GraphQLName("path")
            @GraphQLDescription("JCR path to compute (defaults to /)")
            String path) {
        try {
            return new JcrStatsComputer().computeStats(path == null || path.isEmpty() ? DEFAULT_PATH : path).getSize();
        } catch (RepositoryException e) {
            LOGGER.error("Failed to compute size for path {}", path, e);
            return -1L;
        }
    }

    @GraphQLField
    @GraphQLName("nodeCount")
    @GraphQLDescription("Returns the number of nodes (root included) under the given path (read-only). Returns -1 on error.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Long nodeCount(
            @GraphQLName("path")
            @GraphQLDescription("JCR path to compute (defaults to /)")
            String path) {
        try {
            final NodeStats stats = new JcrStatsComputer().computeStats(path == null || path.isEmpty() ? DEFAULT_PATH : path);
            return JcrStatsComputer.countNodes(stats);
        } catch (RepositoryException e) {
            LOGGER.error("Failed to count nodes for path {}", path, e);
            return -1L;
        }
    }

    @GraphQLField
    @GraphQLName("tree")
    @GraphQLDescription("Returns the size-weighted node tree under the given path, for client-side flamegraph rendering. "
            + "Sizes are fully aggregated; children are pruned below maxDepth to bound the payload.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public GqlNodeStats tree(
            @GraphQLName("path")
            @GraphQLDescription("JCR path to compute (defaults to /)")
            String path,

            @GraphQLName("maxDepth")
            @GraphQLDescription("Maximum number of child levels to include (default 6). Deeper sizes remain aggregated into their ancestors.")
            Integer maxDepth) {
        try {
            final NodeStats stats = new JcrStatsComputer()
                    .computeStats(path == null || path.isEmpty() ? DEFAULT_PATH : path);
            final int depth = maxDepth == null ? DEFAULT_MAX_DEPTH : Math.max(0, maxDepth);
            return new GqlNodeStats(stats, depth);
        } catch (RepositoryException e) {
            LOGGER.error("Failed to build node tree for path {}", path, e);
            return null;
        }
    }

    @GraphQLField
    @GraphQLName("status")
    @GraphQLDescription("Status of the asynchronous computation: running flag, last path, error, and whether a cached result is ready.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public GqlJcrStatsStatus status() {
        final JcrStatsService service = BundleUtils.getOsgiService(JcrStatsService.class, null);
        if (service == null) {
            return new GqlJcrStatsStatus(false, null, null, false, 0L, 0L, 0L, false);
        }
        return new GqlJcrStatsStatus(service.isRunning(), service.getLastPath(), service.getLastError(), service.getLastResult() != null,
                service.getStartedAt(), service.getElapsedMs(), service.getVisitedCount(), service.isLastRunCancelled());
    }

    @GraphQLField
    @GraphQLName("result")
    @GraphQLDescription("Returns the latest asynchronously-computed tree pruned to maxDepth, or null if none is available yet.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public GqlNodeStats result(
            @GraphQLName("maxDepth")
            @GraphQLDescription("Maximum number of child levels to include (default 6).")
            Integer maxDepth) {
        final JcrStatsService service = BundleUtils.getOsgiService(JcrStatsService.class, null);
        if (service == null) {
            return null;
        }
        final NodeStats tree = service.getLastResult();
        if (tree == null) {
            return null;
        }
        final int depth = maxDepth == null ? DEFAULT_MAX_DEPTH : Math.max(0, maxDepth);
        return new GqlNodeStats(tree, depth);
    }

    @GraphQLField
    @GraphQLName("exclusions")
    @GraphQLDescription("The absolute JCR paths currently excluded from computations (each excludes that node and its subtree).")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public List<String> exclusions() {
        final JcrStatsConfig config = BundleUtils.getOsgiService(JcrStatsConfig.class, null);
        return config == null ? Collections.emptyList() : new ArrayList<>(config.getExcludedPaths());
    }

    @GraphQLField
    @GraphQLName("reports")
    @GraphQLDescription("Lists the generated flamegraph files stored under " + REPORTS_BASE_PATH)
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public List<GqlJcrStatsReport> reports() {
        try {
            return JCRTemplate.getInstance().doExecuteWithSystemSession(session -> {
                final List<GqlJcrStatsReport> reports = new ArrayList<>();
                if (!session.nodeExists(REPORTS_BASE_PATH)) {
                    return reports;
                }
                // sqlEncode the path for consistency/defense-in-depth (it is a constant today, so
                // behaviour is unchanged — this guards against future changes making it dynamic).
                // Exclude the snapshots subfolder: HTML reports and JSON execution snapshots are listed
                // by separate queries (reports() vs snapshots()).
                final String stmt = String.format(
                        "SELECT * FROM [jnt:file] AS report WHERE ISDESCENDANTNODE(report, '%s') AND NOT ISDESCENDANTNODE(report, '%s')",
                        JCRContentUtils.sqlEncode(REPORTS_BASE_PATH), JCRContentUtils.sqlEncode(JcrStatsComputer.SNAPSHOTS_PATH));
                final QueryWrapper query = session.getWorkspace().getQueryManager().createQuery(stmt, Query.JCR_SQL2);
                final JCRNodeIteratorWrapper nodes = query.execute().getNodes();
                while (nodes.hasNext()) {
                    final JCRNodeWrapper node = (JCRNodeWrapper) nodes.next();
                    reports.add(new GqlJcrStatsReport(node.getPath(), node.getName(), JcrStatsComputer.flamegraphUrl(node.getPath())));
                }
                return reports;
            });
        } catch (RepositoryException e) {
            LOGGER.error("Failed to list jcr-stats reports", e);
            return Collections.emptyList();
        }
    }

    @GraphQLField
    @GraphQLName("snapshots")
    @GraphQLDescription("Lists the auto-saved JSON execution snapshots (most recent first). Each has a url whose JSON content can be loaded back into the viewer.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public List<GqlJcrStatsReport> snapshots() {
        try {
            return JCRTemplate.getInstance().doExecuteWithSystemSession(session -> {
                final List<GqlJcrStatsReport> snapshots = new ArrayList<>();
                if (!session.nodeExists(JcrStatsComputer.SNAPSHOTS_PATH)) {
                    return snapshots;
                }
                final String stmt = String.format(
                        "SELECT * FROM [jnt:file] AS snapshot WHERE ISDESCENDANTNODE(snapshot, '%s') ORDER BY [jcr:created] DESC",
                        JCRContentUtils.sqlEncode(JcrStatsComputer.SNAPSHOTS_PATH));
                final QueryWrapper query = session.getWorkspace().getQueryManager().createQuery(stmt, Query.JCR_SQL2);
                final JCRNodeIteratorWrapper nodes = query.execute().getNodes();
                while (nodes.hasNext()) {
                    final JCRNodeWrapper node = (JCRNodeWrapper) nodes.next();
                    snapshots.add(new GqlJcrStatsReport(node.getPath(), node.getName(), JcrStatsComputer.flamegraphUrl(node.getPath())));
                }
                return snapshots;
            });
        } catch (RepositoryException e) {
            LOGGER.error("Failed to list jcr-stats execution snapshots", e);
            return Collections.emptyList();
        }
    }

    @GraphQLName("JcrStatsStatus")
    @GraphQLDescription("Status of the asynchronous JCR stats computation")
    public static class GqlJcrStatsStatus {

        private final boolean running;
        private final String path;
        private final String error;
        private final boolean hasResult;
        private final long startedAt;
        private final long elapsedMs;
        private final long visitedCount;
        private final boolean cancelled;

        public GqlJcrStatsStatus(boolean running, String path, String error, boolean hasResult,
                long startedAt, long elapsedMs, long visitedCount, boolean cancelled) {
            this.running = running;
            this.path = path;
            this.error = error;
            this.hasResult = hasResult;
            this.startedAt = startedAt;
            this.elapsedMs = elapsedMs;
            this.visitedCount = visitedCount;
            this.cancelled = cancelled;
        }

        @GraphQLField
        @GraphQLName("running")
        @GraphQLDescription("Whether a computation is currently in progress")
        public boolean isRunning() {
            return running;
        }

        @GraphQLField
        @GraphQLName("path")
        @GraphQLDescription("Path of the last (or in-progress) computation")
        public String getPath() {
            return path;
        }

        @GraphQLField
        @GraphQLName("error")
        @GraphQLDescription("Error message of the last computation, or null")
        public String getError() {
            return error;
        }

        @GraphQLField
        @GraphQLName("hasResult")
        @GraphQLDescription("Whether a cached result is available to fetch")
        public boolean isHasResult() {
            return hasResult;
        }

        @GraphQLField
        @GraphQLName("startedAt")
        @GraphQLDescription("Epoch millis when the current/last computation started (0 if none)")
        public long getStartedAt() {
            return startedAt;
        }

        @GraphQLField
        @GraphQLName("elapsedMs")
        @GraphQLDescription("Elapsed time in ms: live while running, otherwise the last run's duration")
        public long getElapsedMs() {
            return elapsedMs;
        }

        @GraphQLField
        @GraphQLName("visitedCount")
        @GraphQLDescription("Number of nodes visited so far (live progress; no total is known up front)")
        public long getVisitedCount() {
            return visitedCount;
        }

        @GraphQLField
        @GraphQLName("cancelled")
        @GraphQLDescription("Whether the last/current run ended because it was cancelled (rather than completing or failing)")
        public boolean isCancelled() {
            return cancelled;
        }
    }

    @GraphQLName("JcrStatsNode")
    @GraphQLDescription("A node in the size-weighted JCR tree (recursive). Maps onto react-flame-graph's {name, value, children}.")
    public static class GqlNodeStats {

        private final String name;
        private final String path;
        private final long size;
        private final long nodeCount;
        private final List<GqlNodeStats> children;

        public GqlNodeStats(NodeStats stats, int remainingDepth) {
            this.name = stats.getName();
            this.path = stats.getPath();
            this.size = stats.getSize();
            this.nodeCount = JcrStatsComputer.countNodes(stats);
            this.children = new ArrayList<>();
            if (remainingDepth > 0) {
                for (NodeStats child : stats.getSubNodeStats()) {
                    children.add(new GqlNodeStats(child, remainingDepth - 1));
                }
            }
        }

        @GraphQLField
        @GraphQLName("name")
        @GraphQLDescription("Node name (last path segment, or ROOT)")
        public String getName() {
            return name;
        }

        @GraphQLField
        @GraphQLName("path")
        @GraphQLDescription("Full JCR path of this node")
        public String getPath() {
            return path;
        }

        @GraphQLField
        @GraphQLName("size")
        @GraphQLDescription("Aggregated size of this node and all its descendants, in bytes")
        public long getSize() {
            return size;
        }

        @GraphQLField
        @GraphQLName("nodeCount")
        @GraphQLDescription("Total number of nodes in this subtree, root included")
        public long getNodeCount() {
            return nodeCount;
        }

        @GraphQLField
        @GraphQLName("children")
        @GraphQLDescription("Child nodes, size-descending; empty once maxDepth is reached")
        public List<GqlNodeStats> getChildren() {
            return children;
        }
    }

    @GraphQLName("JcrStatsReport")
    @GraphQLDescription("A generated flamegraph report stored in the JCR")
    public static class GqlJcrStatsReport {

        private final String path;
        private final String name;
        private final String url;

        public GqlJcrStatsReport(String path, String name, String url) {
            this.path = path;
            this.name = name;
            this.url = url;
        }

        @GraphQLField
        @GraphQLName("path")
        @GraphQLDescription("JCR path of the flamegraph file")
        public String getPath() {
            return path;
        }

        @GraphQLField
        @GraphQLName("name")
        @GraphQLDescription("Name of the flamegraph file node")
        public String getName() {
            return name;
        }

        @GraphQLField
        @GraphQLName("url")
        @GraphQLDescription("Browser URL that renders this flamegraph")
        public String getUrl() {
            return url;
        }
    }
}
