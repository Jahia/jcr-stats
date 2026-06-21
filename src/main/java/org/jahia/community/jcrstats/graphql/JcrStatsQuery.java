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
            final JcrStatsComputer computer = new JcrStatsComputer();
            final NodeStats stats = computer.computeStats(path == null || path.isEmpty() ? DEFAULT_PATH : path);
            return computer.countNodes(stats);
        } catch (RepositoryException e) {
            LOGGER.error("Failed to count nodes for path {}", path, e);
            return -1L;
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
                    reports.add(new GqlJcrStatsReport(node.getPath(), node.getName()));
                }
                return reports;
            });
        } catch (RepositoryException e) {
            LOGGER.error("Failed to list jcr-stats reports", e);
            return Collections.emptyList();
        }
    }

    @GraphQLName("JcrStatsReport")
    @GraphQLDescription("A generated flamegraph report stored in the JCR")
    public static class GqlJcrStatsReport {

        private final String path;
        private final String name;

        public GqlJcrStatsReport(String path, String name) {
            this.path = path;
            this.name = name;
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
    }
}
