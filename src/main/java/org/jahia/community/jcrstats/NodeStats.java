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

    @Override
    public int compareTo(NodeStats other) {
        return Long.compare(other.size, this.size);
    }

    @Override
    public int hashCode() {
        int hash = 7;
        hash = 37 * hash + Objects.hashCode(this.subNodeStats);
        hash = 37 * hash + Objects.hashCode(this.path);
        hash = 37 * hash + Objects.hashCode(this.size);
        return hash;
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
        if (!Objects.equals(this.path, other.path)) {
            return false;
        }
        if (!Objects.equals(this.subNodeStats, other.subNodeStats)) {
            return false;
        }
        return Objects.equals(this.size, other.size);
    }
}
