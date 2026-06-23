package org.jahia.community.jcrstats;

import org.junit.Before;
import org.junit.Test;

import org.json.JSONObject;

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

    // --- JSON snapshot serialization ---

    @Test
    public void jsonEscape_escapesQuotesBackslashAndControlChars() {
        assertThat(JcrStatsComputer.jsonEscape("a\"b\\c")).isEqualTo("a\\\"b\\\\c");
        assertThat(JcrStatsComputer.jsonEscape("line\nbreak\ttab")).isEqualTo("line\\nbreak\\ttab");
        assertThat(JcrStatsComputer.jsonEscape(null)).isEmpty();
    }

    @Test
    public void buildSnapshotJson_producesLoadableEnvelopeWithTree() {
        NodeStats root = new NodeStats("/");
        NodeStats child = new NodeStats("/alpha");
        child.setSize(300L);
        root.addSubNodeStats(child);

        String json = JcrStatsComputer.buildSnapshotJson(root, "/");

        // Envelope matches the UI importer's expected shape (format + tree with name/size/nodeCount).
        assertThat(json)
                .contains("\"format\":\"jcr-stats-flamegraph\"")
                .contains("\"version\":1")
                .contains("\"path\":\"/\"")
                .contains("\"maxDepth\":6")
                .contains("\"name\":\"ROOT\"")
                .contains("\"name\":\"alpha\"")
                .contains("\"size\":300")
                .contains("\"nodeCount\":2");
    }

    @Test
    public void jsonEscape_escapesBackspaceFormFeedAndControlChars() {
        assertThat(JcrStatsComputer.jsonEscape("a\bb")).isEqualTo("a\\bb");
        assertThat(JcrStatsComputer.jsonEscape("a\fb")).isEqualTo("a\\fb");
        // A C0 control character (U+0001) becomes a six-character unicode escape.
        assertThat(JcrStatsComputer.jsonEscape("a\u0001b")).isEqualTo("a\\u0001b");
    }

    @Test
    public void jsonEscape_escapesLoneSurrogate() {
        // A lone high surrogate would otherwise produce invalid UTF-8/JSON; it must be unicode-escaped.
        assertThat(JcrStatsComputer.jsonEscape("a\ud800b")).isEqualTo("a\\ud800b");
    }

    @Test
    public void buildSnapshotJson_emptyTree_parsesWithEmptyChildren() {
        NodeStats root = new NodeStats("/");

        String json = JcrStatsComputer.buildSnapshotJson(root, "/");

        // The envelope must be valid, parseable JSON (not just substring-shaped).
        JSONObject parsed = new JSONObject(json);
        assertThat(parsed.getString("format")).isEqualTo("jcr-stats-flamegraph");
        JSONObject tree = parsed.getJSONObject("tree");
        assertThat(tree.getString("name")).isEqualTo("ROOT");
        assertThat(tree.getJSONArray("children")).isEmpty();
    }

    @Test
    public void buildSnapshotJson_treeDeeperThanMaxDepth_prunesBeyondLevelSix() {
        // Build a chain of depth 8 (root + 7 descendants). SNAPSHOT_MAX_DEPTH is 6, so the level-7 node
        // must be pruned: walking the children array 6 times reaches a leaf with no further children.
        NodeStats root = new NodeStats("/n0");
        NodeStats current = root;
        for (int i = 1; i <= 7; i++) {
            NodeStats child = new NodeStats("/n0/n" + i);
            current.addSubNodeStats(child);
            current = child;
        }

        String json = JcrStatsComputer.buildSnapshotJson(root, "/n0");

        JSONObject node = new JSONObject(json).getJSONObject("tree");
        // Descend the maximum kept depth (6 child levels).
        for (int level = 0; level < 6; level++) {
            assertThat(node.getJSONArray("children")).as("level %d still has children", level).hasSize(1);
            node = node.getJSONArray("children").getJSONObject(0);
        }
        // At level 6 (the 7th node) children are pruned even though a deeper node exists in the model.
        assertThat(node.getJSONArray("children")).isEmpty();
    }

    // --- saveSnapshot validation branches (rejection paths return null) ---

    @Test
    public void saveSnapshot_nullOrEmpty_isRejected() {
        assertThat(computer.saveSnapshot(null)).isNull();
        assertThat(computer.saveSnapshot("")).isNull();
    }

    @Test
    public void saveSnapshot_wrongFormat_isRejected() {
        // Valid JSON object, but the format tag is not the jcr-stats envelope.
        assertThat(computer.saveSnapshot("{\"format\":\"something-else\",\"tree\":{}}")).isNull();
    }

    @Test
    public void saveSnapshot_malformedJson_isRejected() {
        // Contains the format substring but is not parseable JSON — the old substring check would have
        // wrongly accepted this; the structural parse rejects it.
        assertThat(computer.saveSnapshot("not json \"format\":\"jcr-stats-flamegraph\"")).isNull();
    }

    @Test
    public void saveSnapshot_missingTree_isRejected() {
        assertThat(computer.saveSnapshot("{\"format\":\"jcr-stats-flamegraph\"}")).isNull();
    }

    // --- isSnapshotPath (delete guard) ---

    @Test
    public void isSnapshotPath_acceptsDirectChildFile_rejectsEverythingElse() {
        assertThat(JcrStatsComputer.isSnapshotPath(JcrStatsComputer.SNAPSHOTS_PATH + "/jcr-stats-x.json")).isTrue();
        // nested deeper than a direct child
        assertThat(JcrStatsComputer.isSnapshotPath(JcrStatsComputer.SNAPSHOTS_PATH + "/sub/x.json")).isFalse();
        // the folder itself (no file segment)
        assertThat(JcrStatsComputer.isSnapshotPath(JcrStatsComputer.SNAPSHOTS_PATH)).isFalse();
        // outside the snapshots folder
        assertThat(JcrStatsComputer.isSnapshotPath("/sites/systemsite/files/secret")).isFalse();
        // traversal attempt
        assertThat(JcrStatsComputer.isSnapshotPath(JcrStatsComputer.SNAPSHOTS_PATH + "/../../etc")).isFalse();
        assertThat(JcrStatsComputer.isSnapshotPath(null)).isFalse();
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
