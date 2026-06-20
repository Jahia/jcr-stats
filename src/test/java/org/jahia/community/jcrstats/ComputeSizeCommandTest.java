package org.jahia.community.jcrstats;

import org.junit.Before;
import org.junit.Test;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the graph-writing logic in {@link ComputeSizeCommand}.
 * No live JCR session or JCRTemplate is required — writeGraphNode is package-private
 * precisely to enable this kind of lightweight unit testing.
 */
public class ComputeSizeCommandTest {

    private ComputeSizeCommand command;

    @Before
    public void setUp() {
        command = new ComputeSizeCommand();
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

        // alpha starts at 0, beta starts at 400 (alpha's size)
        assertThat(lines[1]).contains(",0,400,");   // startPosition=0 for alpha
        assertThat(lines[2]).contains(",400,100,");  // startPosition=400 for beta
    }

    // --- helper ---

    private String invokeWriteGraphNode(NodeStats nodeStats, int level, Long startPosition) throws IOException {
        StringWriter sw = new StringWriter();
        try (BufferedWriter bw = new BufferedWriter(sw)) {
            try {
                command.writeGraphNode(nodeStats, bw, level, startPosition);
            } catch (Exception ex) {
                throw new IOException(ex);
            }
        }
        return sw.toString();
    }
}
