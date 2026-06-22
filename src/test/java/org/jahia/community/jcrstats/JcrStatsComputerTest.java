package org.jahia.community.jcrstats;

import org.junit.Before;
import org.junit.Test;

import java.io.BufferedWriter;
import java.io.StringWriter;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the graph-writing and counting logic in {@link JcrStatsComputer}.
 * No live JCR session or JCRTemplate is required — writeGraphNode is package-private
 * precisely to enable this kind of lightweight unit testing.
 */
public class JcrStatsComputerTest {

    private JcrStatsComputer computer;

    @Before
    public void setUp() {
        computer = new JcrStatsComputer();
    }

    @Test
    public void writeGraphNode_singleLeafNode_emitsOneLine() throws Exception {
        NodeStats leaf = new NodeStats("/");
        leaf.setSize(1024L);

        String output = invokeWriteGraphNode(leaf, 0, 0L);

        assertThat(output.trim()).isEqualTo("f(0,0,1024,0,\"ROOT\")");
    }

    @Test
    public void writeGraphNode_nodeWithTwoChildren_emitsThreeLines() throws Exception {
        NodeStats root = new NodeStats("/");
        NodeStats childA = new NodeStats("/alpha");
        childA.setSize(300L);
        NodeStats childB = new NodeStats("/beta");
        childB.setSize(200L);

        // addSubNodeStats keeps children size-descending, accumulates parent size
        root.addSubNodeStats(childA);
        root.addSubNodeStats(childB);

        String output = invokeWriteGraphNode(root, 0, 0L);
        String[] lines = output.lines()
                .filter(l -> !l.isBlank())
                .toArray(String[]::new);

        // Root line first
        assertThat(lines[0]).isEqualTo("f(0,0,500,0,\"ROOT\")");
        // Children at level 1 — order is size-descending: alpha (300) before beta (200)
        assertThat(lines[1]).isEqualTo("f(1,0,300,0,\"alpha\")");
        assertThat(lines[2]).isEqualTo("f(1,300,200,0,\"beta\")");
        assertThat(lines).hasSize(3);
    }

    @Test
    public void writeGraphNode_sameSizeSiblings_bothEmitted() throws Exception {
        NodeStats root = new NodeStats("/");
        NodeStats childA = new NodeStats("/alpha");
        childA.setSize(512L);
        NodeStats childB = new NodeStats("/beta");
        childB.setSize(512L);

        root.addSubNodeStats(childA);
        root.addSubNodeStats(childB);

        String output = invokeWriteGraphNode(root, 0, 0L);
        long nodeLineCount = output.lines().filter(l -> l.startsWith("f(")).count();

        assertThat(nodeLineCount)
                .as("Root + two same-size siblings must all produce output lines")
                .isEqualTo(3);
    }

    @Test
    public void writeGraphNode_startPositionAdvancesAcrossSiblings() throws Exception {
        NodeStats root = new NodeStats("/");
        NodeStats childA = new NodeStats("/alpha");
        childA.setSize(400L);
        NodeStats childB = new NodeStats("/beta");
        childB.setSize(100L);

        root.addSubNodeStats(childA);
        root.addSubNodeStats(childB);

        String output = invokeWriteGraphNode(root, 0, 0L);
        String[] lines = output.lines()
                .filter(l -> !l.isBlank())
                .toArray(String[]::new);

        // alpha starts at 0 (level 1), beta starts at 400 (alpha's size, level 1)
        assertThat(lines[1]).isEqualTo("f(1,0,400,0,\"alpha\")");
        assertThat(lines[2]).isEqualTo("f(1,400,100,0,\"beta\")");
    }

    // --- countNodes ---

    @Test
    public void countNodes_singleNode_returnsOne() {
        assertThat(JcrStatsComputer.countNodes(new NodeStats("/"))).isEqualTo(1L);
    }

    @Test
    public void countNodes_treeWithNestedChildren_countsAllNodes() {
        NodeStats root = new NodeStats("/");
        NodeStats childA = new NodeStats("/alpha");
        NodeStats childB = new NodeStats("/beta");
        NodeStats grandChild = new NodeStats("/alpha/leaf");
        childA.addSubNodeStats(grandChild);
        root.addSubNodeStats(childA);
        root.addSubNodeStats(childB);

        // root + alpha + beta + leaf = 4
        assertThat(JcrStatsComputer.countNodes(root)).isEqualTo(4L);
    }

    // --- flamegraphUrl ---

    @Test
    public void flamegraphUrl_null_returnsNull() {
        assertThat(JcrStatsComputer.flamegraphUrl(null)).isNull();
    }

    @Test
    public void flamegraphUrl_validPath_prependsDefaultWorkspacePrefix() {
        String input = "/sites/systemsite/files/jcr-stats/x/flamegraph";
        assertThat(JcrStatsComputer.flamegraphUrl(input))
                .isEqualTo("/files/default/sites/systemsite/files/jcr-stats/x/flamegraph");
    }

    // --- NodeStats nodeCount accumulation ---

    @Test
    public void nodeCount_rootWithChildAndGrandchild_accumulatesToFour() {
        // Arrange: root -> childA -> grandChild, root -> childB
        NodeStats root = new NodeStats("/root");
        NodeStats childA = new NodeStats("/root/childA");
        NodeStats childB = new NodeStats("/root/childB");
        NodeStats grandChild = new NodeStats("/root/childA/grandChild");

        childA.addSubNodeStats(grandChild);  // childA.nodeCount = 2
        root.addSubNodeStats(childA);         // root.nodeCount = 1 + 2 = 3
        root.addSubNodeStats(childB);         // root.nodeCount = 3 + 1 = 4

        assertThat(root.getNodeCount()).isEqualTo(4L);
        assertThat(JcrStatsComputer.countNodes(root)).isEqualTo(4L);
    }

    @Test
    public void nodeCount_freshNode_isOne() {
        assertThat(new NodeStats("/single").getNodeCount()).isEqualTo(1L);
    }

    // --- GqlNodeStats depth pruning ---

    @Test
    public void gqlNodeStats_depthZero_childrenEmptyButNodeCountFull() {
        // Arrange: same 4-node tree as above
        NodeStats root = new NodeStats("/root");
        NodeStats childA = new NodeStats("/root/childA");
        NodeStats childB = new NodeStats("/root/childB");
        NodeStats grandChild = new NodeStats("/root/childA/grandChild");
        childA.addSubNodeStats(grandChild);
        root.addSubNodeStats(childA);
        root.addSubNodeStats(childB);

        // Act: depth 0 prunes all children
        org.jahia.community.jcrstats.graphql.JcrStatsQuery.GqlNodeStats gql =
                new org.jahia.community.jcrstats.graphql.JcrStatsQuery.GqlNodeStats(root, 0);

        // Assert: no children exposed but nodeCount reflects the full subtree
        assertThat(gql.getChildren()).isEmpty();
        assertThat(gql.getNodeCount()).isEqualTo(4L);
    }

    @Test
    public void gqlNodeStats_depthOne_exposesImmediateChildrenOnly() {
        NodeStats root = new NodeStats("/root");
        NodeStats childA = new NodeStats("/root/childA");
        NodeStats childB = new NodeStats("/root/childB");
        NodeStats grandChild = new NodeStats("/root/childA/grandChild");
        childA.addSubNodeStats(grandChild);
        root.addSubNodeStats(childA);
        root.addSubNodeStats(childB);

        org.jahia.community.jcrstats.graphql.JcrStatsQuery.GqlNodeStats gql =
                new org.jahia.community.jcrstats.graphql.JcrStatsQuery.GqlNodeStats(root, 1);

        // Two direct children exposed; their children pruned (depth 0 for them)
        assertThat(gql.getChildren()).hasSize(2);
        gql.getChildren().forEach(child ->
                assertThat(child.getChildren()).isEmpty());
        // Root nodeCount still covers the whole subtree
        assertThat(gql.getNodeCount()).isEqualTo(4L);
    }

    // --- helper ---

    private String invokeWriteGraphNode(NodeStats nodeStats, int level, long startPosition) throws Exception {
        StringWriter sw = new StringWriter();
        try (BufferedWriter bw = new BufferedWriter(sw)) {
            computer.writeGraphNode(nodeStats, bw, level, startPosition);
        }
        return sw.toString();
    }
}
