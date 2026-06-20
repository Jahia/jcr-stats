package org.jahia.community.jcrstats;

import org.junit.Test;

import java.util.Iterator;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link NodeStats}.
 */
public class NodeStatsTest {

    // --- getName ---

    @Test
    public void getName_rootPath_returnsROOT() {
        NodeStats nodeStats = new NodeStats("/");
        assertThat(nodeStats.getName()).isEqualTo("ROOT");
    }

    @Test
    public void getName_deepPath_returnsLastSegment() {
        NodeStats nodeStats = new NodeStats("/sites/foo/bar");
        assertThat(nodeStats.getName()).isEqualTo("bar");
    }

    // --- addSubNodeStats ---

    @Test
    public void addSubNodeStats_accumulatesSizeOntoParent() {
        NodeStats parent = new NodeStats("/parent");
        NodeStats child = new NodeStats("/parent/child");
        child.setSize(100L);

        parent.addSubNodeStats(child);

        assertThat(parent.getSize()).isEqualTo(100L);
    }

    @Test
    public void addSubNodeStats_multipleChildren_accumulatesAllSizes() {
        NodeStats parent = new NodeStats("/parent");
        NodeStats child1 = new NodeStats("/parent/a");
        child1.setSize(200L);
        NodeStats child2 = new NodeStats("/parent/b");
        child2.setSize(300L);

        parent.addSubNodeStats(child1);
        parent.addSubNodeStats(child2);

        assertThat(parent.getSize()).isEqualTo(500L);
    }

    // --- Regression: sibling nodes with same size must NOT be collapsed ---

    @Test
    public void addSubNodeStats_sameSizeDifferentPaths_bothRetained() {
        NodeStats parent = new NodeStats("/parent");
        NodeStats child1 = new NodeStats("/parent/alpha");
        child1.setSize(512L);
        NodeStats child2 = new NodeStats("/parent/beta");
        child2.setSize(512L);

        parent.addSubNodeStats(child1);
        parent.addSubNodeStats(child2);

        // Before the compareTo fix both siblings had the same size so the second
        // add() was a no-op in the TreeSet (compareTo returned 0 → treated as equal).
        assertThat(parent.getSubNodeStats())
                .as("Both siblings must be retained even when they share the same size")
                .hasSize(2);
    }

    // --- compareTo / iteration order ---

    @Test
    public void compareTo_largerNodeComesFirst() {
        NodeStats large = new NodeStats("/large");
        large.setSize(1000L);
        NodeStats small = new NodeStats("/small");
        small.setSize(100L);

        assertThat(large.compareTo(small)).isLessThan(0);
        assertThat(small.compareTo(large)).isGreaterThan(0);
    }

    @Test
    public void compareTo_reflexive() {
        NodeStats node = new NodeStats("/sites/foo");
        node.setSize(42L);
        assertThat(node.compareTo(node)).isEqualTo(0);
    }

    @Test
    public void subNodeStats_iteratesInSizeDescendingOrder() {
        NodeStats parent = new NodeStats("/parent");
        NodeStats small = new NodeStats("/parent/small");
        small.setSize(10L);
        NodeStats large = new NodeStats("/parent/large");
        large.setSize(999L);
        NodeStats medium = new NodeStats("/parent/medium");
        medium.setSize(500L);

        parent.addSubNodeStats(small);
        parent.addSubNodeStats(large);
        parent.addSubNodeStats(medium);

        Iterator<NodeStats> it = parent.getSubNodeStats().iterator();
        assertThat(it.next().getSize()).isEqualTo(999L);
        assertThat(it.next().getSize()).isEqualTo(500L);
        assertThat(it.next().getSize()).isEqualTo(10L);
    }

    // --- equals / hashCode ---

    @Test
    public void equals_reflexive() {
        NodeStats node = new NodeStats("/sites/foo");
        node.setSize(42L);
        assertThat(node).isEqualTo(node);
    }

    @Test
    public void equals_samePathSizeAndChildren_areEqual() {
        NodeStats a = new NodeStats("/sites/foo");
        a.setSize(42L);
        NodeStats b = new NodeStats("/sites/foo");
        b.setSize(42L);
        assertThat(a).isEqualTo(b).hasSameHashCodeAs(b);
    }

    @Test
    public void equals_differentPath_areNotEqual() {
        NodeStats a = new NodeStats("/sites/foo");
        a.setSize(42L);
        NodeStats b = new NodeStats("/sites/bar");
        b.setSize(42L);
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    public void equals_samePathDifferentSize_areEqual() {
        // Identity is the JCR path only; size is a derived/structural attribute.
        NodeStats a = new NodeStats("/sites/foo");
        a.setSize(42L);
        NodeStats b = new NodeStats("/sites/foo");
        b.setSize(99L);
        assertThat(a).isEqualTo(b).hasSameHashCodeAs(b);
    }
}
