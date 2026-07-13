package org.jahia.community.jcrstats;

import org.apache.jackrabbit.JcrConstants;
import org.jahia.services.content.JCRCallback;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRPropertyWrapper;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.content.JCRTemplate;
import org.junit.Test;
import org.mockito.MockedStatic;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

/**
 * U2 + D3 — CHARACTERIZATION of the current exclusion divergence (NOT a desired invariant).
 *
 * <p>Configured path exclusions are threaded into the traversal by exactly one caller: the async
 * {@code JcrStatsService.start(...)} job, which calls the 4-argument
 * {@code computeStats(path, visited, cancelled, excludedPath)} overload with {@code config::isExcluded}.
 * Every other surface — {@code size}/{@code nodeCount}/{@code tree} (GraphQL queries),
 * {@code computeSize} (mutation) and the Karaf CLI — goes through the single-argument
 * {@code computeStats(path)} which hard-codes the no-op predicate {@code p -> false}, so an excluded
 * subtree is <em>still counted</em> there.</p>
 *
 * <p><strong>Stage-7 handoff:</strong> this divergence is an incomplete-wiring bug, not intentional
 * async-only design. When Stage 7 makes exclusions apply consistently (default the predicate to the
 * live config across all overloads/callers), INVERT the assertion in
 * {@link #singleArgComputeStats_ignoresExclusions_currentDivergence()} — the excluded subtree should
 * then be dropped everywhere, matching {@link #fourArgComputeStats_honorsExclusions()}.</p>
 */
public class ExclusionDivergenceTest {

    private final JcrStatsComputer computer = new JcrStatsComputer();

    private static void runCallbacksAgainst(MockedStatic<JCRTemplate> mockedTemplate, JCRSessionWrapper session)
            throws Exception {
        final JCRTemplate template = mock(JCRTemplate.class);
        mockedTemplate.when(JCRTemplate::getInstance).thenReturn(template);
        when(template.doExecuteWithSystemSession(any(JCRCallback.class)))
                .thenAnswer(inv -> ((JCRCallback<?>) inv.getArgument(0)).doInJCR(session));
    }

    @Test
    public void fourArgComputeStats_honorsExclusions() throws Exception {
        // The async path: exclude /root/big — only /root and /root/keep remain.
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = sampleTree();
            when(session.getNode("/root", false)).thenReturn(root);

            final Predicate<String> excludeBig = path -> path.equals("/root/big");
            final NodeStats stats = computer.computeStats("/root", new AtomicLong(), () -> false, excludeBig);

            assertThat(stats.getSize()).as("excluded subtree removed from the total").isEqualTo(100L);
            assertThat(stats.getNodeCount()).as("only /root + /root/keep counted").isEqualTo(2L);
        }
    }

    @Test
    public void singleArgComputeStats_ignoresExclusions_currentDivergence() throws Exception {
        // The read/CLI path (size/nodeCount/tree/computeSize) uses the single-arg overload, whose
        // predicate is hard-coded to p -> false. The SAME /root/big subtree is therefore still counted.
        // >>> Stage-7: once exclusions are made consistent, this expectation must be INVERTED to 100/2.
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = sampleTree();
            when(session.getNode("/root", false)).thenReturn(root);

            final NodeStats stats = computer.computeStats("/root");

            assertThat(stats.getSize())
                    .as("CURRENT (divergent) behavior: /root/big is NOT excluded on the sync path")
                    .isEqualTo(600L);
            assertThat(stats.getNodeCount())
                    .as("CURRENT (divergent) behavior: all four nodes counted")
                    .isEqualTo(4L);
        }
    }

    /** /root -> {keep(100), big -> child(500)} — a fresh mock tree (iterators are single-use). */
    private static JCRNodeWrapper sampleTree() throws Exception {
        final JCRNodeWrapper keep = leaf("/root/keep", 100L);
        final JCRNodeWrapper bigChild = leaf("/root/big/child", 500L);
        final JCRNodeWrapper big = branch("/root/big", bigChild);
        return branch("/root", keep, big);
    }

    private static JCRNodeWrapper leaf(String path, long size) throws Exception {
        final JCRNodeWrapper node = mock(JCRNodeWrapper.class);
        when(node.getPath()).thenReturn(path);
        final JCRPropertyWrapper data = mock(JCRPropertyWrapper.class);
        when(data.getLength()).thenReturn(size);
        when(node.hasProperty(JcrConstants.JCR_DATA)).thenReturn(true);
        when(node.getProperty(JcrConstants.JCR_DATA)).thenReturn(data);
        final JCRNodeIteratorWrapper empty = iterator();
        when(node.getNodes()).thenReturn(empty);
        return node;
    }

    private static JCRNodeWrapper branch(String path, JCRNodeWrapper... children) throws Exception {
        final JCRNodeWrapper node = mock(JCRNodeWrapper.class);
        when(node.getPath()).thenReturn(path);
        when(node.hasProperty(JcrConstants.JCR_DATA)).thenReturn(false);
        final JCRNodeIteratorWrapper it = iterator(children);
        when(node.getNodes()).thenReturn(it);
        return node;
    }

    private static JCRNodeIteratorWrapper iterator(JCRNodeWrapper... nodes) {
        final JCRNodeIteratorWrapper iterator = mock(JCRNodeIteratorWrapper.class);
        final int[] cursor = {0};
        when(iterator.hasNext()).thenAnswer(inv -> cursor[0] < nodes.length);
        when(iterator.next()).thenAnswer(inv -> nodes[cursor[0]++]);
        return iterator;
    }
}
