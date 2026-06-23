package org.jahia.community.jcrstats.graphql;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import org.jahia.community.jcrstats.ComputeResult;
import org.jahia.community.jcrstats.JcrStatsComputer;
import org.jahia.community.jcrstats.JcrStatsConfig;
import org.jahia.community.jcrstats.JcrStatsService;
import org.jahia.modules.graphql.provider.dxm.security.GraphQLRequiresPermission;
import org.jahia.osgi.BundleUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;

@GraphQLName("JcrStatsMutation")
@GraphQLDescription("JCR Stats mutations")
public class JcrStatsMutation {

    private static final Logger LOGGER = LoggerFactory.getLogger(JcrStatsMutation.class);

    @GraphQLField
    @GraphQLName("compute")
    @GraphQLDescription("Starts an asynchronous computation of the subtree at the given path. Returns false if one is already running. Poll jcrStats.status, then read jcrStats.result when it finishes.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Boolean compute(
            @GraphQLName("path")
            @GraphQLDescription("JCR path to compute (defaults to /)")
            String path) {
        final JcrStatsService service = BundleUtils.getOsgiService(JcrStatsService.class, null);
        return service != null && service.start(path);
    }

    @GraphQLField
    @GraphQLName("cancel")
    @GraphQLDescription("Requests cancellation of the running asynchronous computation. Returns true if a job was running and cancellation was requested, false if nothing was running.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Boolean cancel() {
        final JcrStatsService service = BundleUtils.getOsgiService(JcrStatsService.class, null);
        return service != null && service.cancel();
    }

    @GraphQLField
    @GraphQLName("saveSnapshot")
    @GraphQLDescription("Stores a snapshot JSON (e.g. a file loaded in the UI) alongside the auto-saved execution snapshots, so loaded data joins the saved-executions history. Returns true on success.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Boolean saveSnapshot(
            @GraphQLName("json")
            @GraphQLDescription("Snapshot JSON in the jcr-stats export envelope (format jcr-stats-flamegraph)")
            String json) {
        return new JcrStatsComputer().saveSnapshot(json) != null;
    }

    @GraphQLField
    @GraphQLName("deleteSnapshot")
    @GraphQLDescription("Deletes a stored execution snapshot. The path must be a file directly under the snapshots folder; any other path is rejected. Returns true if a snapshot was found and deleted.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Boolean deleteSnapshot(
            @GraphQLName("path")
            @GraphQLDescription("JCR path of the snapshot file to delete (must be under the jcr-stats snapshots folder)")
            String path) {
        return new JcrStatsComputer().deleteSnapshot(path);
    }

    @GraphQLField
    @GraphQLName("addExclusion")
    @GraphQLDescription("Adds an absolute JCR path to the exclusion list: the path and its whole subtree are skipped in future computations. Persisted to the OSGi configuration file. Returns true on success, false if the path is invalid or could not be saved.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Boolean addExclusion(
            @GraphQLName("path")
            @GraphQLDescription("Absolute JCR path to exclude (e.g. /sites/mySite/files/cloud-dumps)")
            String path) {
        final JcrStatsConfig config = BundleUtils.getOsgiService(JcrStatsConfig.class, null);
        return config != null && config.addExclusion(path);
    }

    @GraphQLField
    @GraphQLName("removeExclusion")
    @GraphQLDescription("Removes a path from the exclusion list and persists the change. Returns true on success.")
    @GraphQLRequiresPermission("jcrStatsAdmin")
    public Boolean removeExclusion(
            @GraphQLName("path")
            @GraphQLDescription("Absolute JCR path to stop excluding")
            String path) {
        final JcrStatsConfig config = BundleUtils.getOsgiService(JcrStatsConfig.class, null);
        return config != null && config.removeExclusion(path);
    }

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
