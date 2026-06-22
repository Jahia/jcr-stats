package org.jahia.community.jcrstats.graphql;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import org.jahia.community.jcrstats.ComputeResult;
import org.jahia.community.jcrstats.JcrStatsComputer;
import org.jahia.modules.graphql.provider.dxm.security.GraphQLRequiresPermission;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;

@GraphQLName("JcrStatsMutation")
@GraphQLDescription("JCR Stats mutations")
public class JcrStatsMutation {

    private static final Logger LOGGER = LoggerFactory.getLogger(JcrStatsMutation.class);

    @GraphQLField
    @GraphQLName("computeSize")
    @GraphQLDescription("Computes the size of the subtree at the given path, writes the flamegraph file into the JCR and returns the aggregated result. Returns null on error.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public GqlJcrStatsComputeResult computeSize(
            @GraphQLName("path")
            @GraphQLDescription("JCR path to compute (defaults to /)")
            String path,

            @GraphQLName("deleteTemporaryFile")
            @GraphQLDescription("Delete the temporary HTML file after uploading it to the JCR")
            Boolean deleteTemporaryFile) {
        try {
            final ComputeResult result = new JcrStatsComputer()
                    .computeAndWriteFlamegraph(path, Boolean.TRUE.equals(deleteTemporaryFile));
            return new GqlJcrStatsComputeResult(
                    result.getPath(), result.getTotalSize(), result.getNodeCount(),
                    result.getFlamegraphPath(), JcrStatsComputer.flamegraphUrl(result.getFlamegraphPath()));
        } catch (RepositoryException e) {
            LOGGER.error("Failed to compute size for path {}", path, e);
            return null;
        }
    }

    @GraphQLName("JcrStatsComputeResult")
    @GraphQLDescription("Result of a JCR size computation")
    public static class GqlJcrStatsComputeResult {

        private final String path;
        private final long totalSize;
        private final long nodeCount;
        private final String flamegraphPath;
        private final String flamegraphUrl;

        public GqlJcrStatsComputeResult(String path, long totalSize, long nodeCount, String flamegraphPath, String flamegraphUrl) {
            this.path = path;
            this.totalSize = totalSize;
            this.nodeCount = nodeCount;
            this.flamegraphPath = flamegraphPath;
            this.flamegraphUrl = flamegraphUrl;
        }

        @GraphQLField
        @GraphQLName("path")
        @GraphQLDescription("The JCR path that was computed")
        public String getPath() {
            return path;
        }

        @GraphQLField
        @GraphQLName("totalSize")
        @GraphQLDescription("Aggregated size of the subtree, in bytes")
        public long getTotalSize() {
            return totalSize;
        }

        @GraphQLField
        @GraphQLName("nodeCount")
        @GraphQLDescription("Number of nodes counted in the subtree (root included)")
        public long getNodeCount() {
            return nodeCount;
        }

        @GraphQLField
        @GraphQLName("flamegraphPath")
        @GraphQLDescription("JCR path of the generated flamegraph file, or null when none was written")
        public String getFlamegraphPath() {
            return flamegraphPath;
        }

        @GraphQLField
        @GraphQLName("flamegraphUrl")
        @GraphQLDescription("Browser URL that renders the generated flamegraph, or null when none was written")
        public String getFlamegraphUrl() {
            return flamegraphUrl;
        }
    }
}
