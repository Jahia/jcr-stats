package org.jahia.community.jcrstats.graphql;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import org.jahia.community.jcrstats.JcrStatsComputer;
import org.jahia.community.jcrstats.NodeStats;
import org.jahia.modules.graphql.provider.dxm.security.GraphQLRequiresPermission;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRTemplate;
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
                final String stmt = String.format(
                        "SELECT * FROM [jnt:file] AS report WHERE ISDESCENDANTNODE(report, '%s')", REPORTS_BASE_PATH);
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

    @GraphQLName("JcrStatsNode")
    @GraphQLDescription("A node in the size-weighted JCR tree (recursive). Maps onto react-flame-graph's {name, value, children}.")
    public static class GqlNodeStats {

        private final String name;
        private final long size;
        private final long nodeCount;
        private final List<GqlNodeStats> children;

        public GqlNodeStats(NodeStats stats, int remainingDepth) {
            this.name = stats.getName();
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
