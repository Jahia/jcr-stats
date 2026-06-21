package org.jahia.community.jcrstats;

/**
 * Immutable result of a JCR size computation.
 *
 * <p>Shared between the Karaf command ({@link ComputeSizeCommand}), the GraphQL API and the admin
 * UI so all three surfaces report the same numbers without duplicating the traversal logic.</p>
 */
public final class ComputeResult {

    private final String path;
    private final long totalSize;
    private final long nodeCount;
    private final String flamegraphPath;

    public ComputeResult(String path, long totalSize, long nodeCount, String flamegraphPath) {
        this.path = path;
        this.totalSize = totalSize;
        this.nodeCount = nodeCount;
        this.flamegraphPath = flamegraphPath;
    }

    /** The JCR path that was computed. */
    public String getPath() {
        return path;
    }

    /** Aggregated size of the subtree, in bytes. */
    public long getTotalSize() {
        return totalSize;
    }

    /** Number of nodes counted in the subtree (root included). */
    public long getNodeCount() {
        return nodeCount;
    }

    /** JCR path of the generated flamegraph file, or {@code null} when none was written. */
    public String getFlamegraphPath() {
        return flamegraphPath;
    }
}
