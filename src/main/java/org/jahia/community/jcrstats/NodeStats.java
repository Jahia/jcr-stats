package org.jahia.community.jcrstats;

import java.util.Objects;
import java.util.SortedSet;
import java.util.TreeSet;
import org.apache.jackrabbit.core.fs.FileSystem;

public class NodeStats implements Comparable<NodeStats> {

    private final TreeSet<NodeStats> subNodeStats = new TreeSet<>();
    private final String path;
    private Long size = 0L;

    public NodeStats(String path) {
        this.path = path;
    }

    public String getName() {
        final String name;
        if (path.equals(FileSystem.SEPARATOR)) {
            name = "ROOT";
        } else {
            name = path.substring(path.lastIndexOf(FileSystem.SEPARATOR) + 1);
        }
        return name;
    }

    public String getPath() {
        return path;
    }

    public void setSize(Long size) {
        this.size = size;
    }

    public Long getSize() {
        return size;
    }

    public void addSize(Long size) {
        this.size = this.size + size;
    }

    public SortedSet<NodeStats> getSubNodeStats() {
        return subNodeStats;
    }

    public void addSubNodeStats(NodeStats nodeStats) {
        subNodeStats.add(nodeStats);
        this.addSize(nodeStats.getSize());
    }

    /**
     * Orders by size descending (largest first) to control flamegraph display order.
     * Tie-break by path ascending is required because TreeSet uses compareTo for both
     * ordering AND uniqueness: two nodes with identical sizes but distinct paths would
     * otherwise compare as 0 and the second add() would be silently dropped, causing
     * sibling data loss and a mismatch between the tree structure and the accumulated totals.
     */
    @Override
    public int compareTo(NodeStats other) {
        int sizeOrder = Long.compare(other.size, this.size);
        if (sizeOrder != 0) {
            return sizeOrder;
        }
        return this.path.compareTo(other.path);
    }

    // Identity is the JCR path (unique per node); size and children are derived.
    // This keeps equals consistent with compareTo's tie-break so the TreeSet never collapses distinct nodes.
    @Override
    public int hashCode() {
        return Objects.hashCode(this.path);
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) {
            return true;
        }
        if (obj == null) {
            return false;
        }
        if (getClass() != obj.getClass()) {
            return false;
        }
        final NodeStats other = (NodeStats) obj;
        return Objects.equals(this.path, other.path);
    }
}
