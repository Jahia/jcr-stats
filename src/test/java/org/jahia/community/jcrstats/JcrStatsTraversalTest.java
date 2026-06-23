package org.jahia.community.jcrstats;

import org.apache.jackrabbit.JcrConstants;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRPropertyWrapper;
import org.junit.Test;

import javax.jcr.RepositoryException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the direct (default) traversal strategy in {@link JcrStatsComputer#computeNode}.
 *
 * <p>{@code computeNode} is package-private precisely so the traversal/aggregation logic can be
 * exercised against mocked {@link JCRNodeWrapper}s, without a live JCR session. The session argument
 * is unused on the default {@code getNodes()} path, so it is passed as {@code null} here.</p>
 */
public class JcrStatsTraversalTest {

    /** Sentinel for {@link #mockNode}: the node carries no {@code jcr:data} property. */
    private static final long NO_DATA = -1L;

    private final JcrStatsComputer computer = new JcrStatsComputer();

    @Test
    public void computeNode_nestedTree_aggregatesSizeCountAndVisitsEachNodeOnce() throws Exception {
        // Arrange: /r -> {a(300) -> g(100), b(200)}
        JCRNodeWrapper grand = mockNode("/r/a/g", 100L);
        JCRNodeWrapper childA = mockNode("/r/a", 300L, grand);
        JCRNodeWrapper childB = mockNode("/r/b", 200L);
        JCRNodeWrapper root = mockNode("/r", NO_DATA, childA, childB);
        AtomicLong visited = new AtomicLong();

        // Act
        NodeStats stats = computer.computeNode(null, root, visited);

        // Assert: sizes roll up (300 + 100 + 200), all four nodes counted and visited exactly once
        assertThat(stats.getSize()).isEqualTo(600L);
        assertThat(stats.getNodeCount()).isEqualTo(4L);
        assertThat(visited.get()).isEqualTo(4L);
    }

    @Test
    public void computeNode_childrenOrderedSizeDescending() throws Exception {
        JCRNodeWrapper small = mockNode("/r/small", 100L);
        JCRNodeWrapper large = mockNode("/r/large", 900L);
        // Insertion order deliberately small-then-large; NodeStats must re-order size-descending.
        JCRNodeWrapper root = mockNode("/r", NO_DATA, small, large);

        NodeStats stats = computer.computeNode(null, root, new AtomicLong());

        List<String> names = new ArrayList<>();
        stats.getSubNodeStats().forEach(child -> names.add(child.getName()));
        assertThat(names).containsExactly("large", "small");
    }

    @Test
    public void computeNode_leafWithData_readsJcrDataLength() throws Exception {
        JCRNodeWrapper leaf = mockNode("/r/file", 4096L);

        NodeStats stats = computer.computeNode(null, leaf, new AtomicLong());

        assertThat(stats.getSize()).isEqualTo(4096L);
        assertThat(stats.getNodeCount()).isEqualTo(1L);
    }

    @Test
    public void computeNode_leafWithoutData_hasZeroSize() throws Exception {
        JCRNodeWrapper leaf = mockNode("/r/folder", NO_DATA);

        NodeStats stats = computer.computeNode(null, leaf, new AtomicLong());

        assertThat(stats.getSize()).isZero();
    }

    // --- helpers ---

    /**
     * Builds a mocked {@link JCRNodeWrapper}. A {@code dataLength} of {@link #NO_DATA} means the node
     * has no {@code jcr:data} property; any other value is exposed via a mocked {@link JCRPropertyWrapper}.
     */
    private JCRNodeWrapper mockNode(String path, long dataLength, JCRNodeWrapper... children) throws RepositoryException {
        JCRNodeWrapper node = mock(JCRNodeWrapper.class);
        when(node.getPath()).thenReturn(path);
        if (dataLength == NO_DATA) {
            when(node.hasProperty(JcrConstants.JCR_DATA)).thenReturn(false);
        } else {
            JCRPropertyWrapper data = mock(JCRPropertyWrapper.class);
            when(data.getLength()).thenReturn(dataLength);
            when(node.hasProperty(JcrConstants.JCR_DATA)).thenReturn(true);
            when(node.getProperty(JcrConstants.JCR_DATA)).thenReturn(data);
        }
        // Build the iterator (which itself stubs) into a local first: stubbing one mock inside an
        // unfinished when(...).thenReturn(...) of another mock trips Mockito's UnfinishedStubbing check.
        JCRNodeIteratorWrapper childIterator = mockIterator(children);
        when(node.getNodes()).thenReturn(childIterator);
        return node;
    }

    /** A {@link JCRNodeIteratorWrapper} that walks the given nodes once, then reports exhausted. */
    private JCRNodeIteratorWrapper mockIterator(JCRNodeWrapper... nodes) {
        JCRNodeIteratorWrapper iterator = mock(JCRNodeIteratorWrapper.class);
        final int[] cursor = {0};
        when(iterator.hasNext()).thenAnswer(invocation -> cursor[0] < nodes.length);
        when(iterator.next()).thenAnswer(invocation -> nodes[cursor[0]++]);
        return iterator;
    }
}
