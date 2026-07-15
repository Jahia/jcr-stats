package org.jahia.community.jcrstats;

import org.apache.jackrabbit.JcrConstants;
import org.jahia.community.jcrstats.graphql.JcrStatsQuery;
import org.jahia.osgi.BundleUtils;
import org.jahia.services.content.JCRCallback;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRPropertyWrapper;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.content.JCRTemplate;
import org.junit.Test;
import org.mockito.MockedStatic;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

/**
 * U2 + D3 — exclusion consistency INVARIANT (Stage-7 fix regression guard).
 *
 * <p>Configured path exclusions used to be threaded into the traversal by exactly one caller: the
 * async {@code JcrStatsService.start(...)} job (the 4-arg
 * {@code computeStats(path, visited, cancelled, excludedPath)} overload with {@code config::isExcluded}).
 * Every other surface — {@code size}/{@code nodeCount}/{@code tree} (GraphQL queries),
 * {@code computeSize} (mutation) and the Karaf CLI — went through the single-argument
 * {@code computeStats(path)} which hard-coded the no-op predicate {@code p -> false}, so an excluded
 * subtree was <em>still counted</em> there. That silent divergence was the headline D3 bug.</p>
 *
 * <p>The fix resolves the live exclusion predicate ({@link JcrStatsComputer#liveExclusions()}) at every
 * compute surface. These tests now assert the desired invariant: with {@code /root/big} configured as
 * excluded, <strong>all</strong> surfaces drop it (100 bytes / 2 nodes, matching the async job) — and,
 * critically, that when nothing is excluded the totals are byte-for-byte identical to the pre-fix
 * behaviour (600/4), proving the change is behaviour-preserving for the no-exclusions case.</p>
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

    /**
     * Stubs the OSGi {@link JcrStatsConfig} lookup that {@link JcrStatsComputer#liveExclusions()}
     * performs, so every surface under test sees {@code /root/big} as excluded.
     */
    private static void configExcludes(MockedStatic<BundleUtils> mockedBundle, String excludedPath) {
        final JcrStatsConfig config = mock(JcrStatsConfig.class);
        when(config.isExcluded(anyString())).thenAnswer(inv -> excludedPath.equals(inv.getArgument(0)));
        mockedBundle.when(() -> BundleUtils.getOsgiService(JcrStatsConfig.class, null)).thenReturn(config);
    }

    @Test
    public void fourArgComputeStats_honorsExclusions() throws Exception {
        // The engine itself has always honoured the explicit predicate (the async path relies on it).
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
    public void sizeQuery_honorsConfiguredExclusions() throws Exception {
        // D3 fix: the size query now applies the configured exclusions (was 600, ignoring them).
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class);
             MockedStatic<BundleUtils> mockedBundle = mockStatic(BundleUtils.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = sampleTree();
            when(session.getNode("/root", false)).thenReturn(root);
            configExcludes(mockedBundle, "/root/big");

            final Long size = new JcrStatsQuery().size("/root");

            assertThat(size).as("size query drops the excluded /root/big subtree").isEqualTo(100L);
        }
    }

    @Test
    public void nodeCountQuery_honorsConfiguredExclusions() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class);
             MockedStatic<BundleUtils> mockedBundle = mockStatic(BundleUtils.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = sampleTree();
            when(session.getNode("/root", false)).thenReturn(root);
            configExcludes(mockedBundle, "/root/big");

            final Long count = new JcrStatsQuery().nodeCount("/root");

            assertThat(count).as("nodeCount query drops the excluded subtree (root + keep only)").isEqualTo(2L);
        }
    }

    @Test
    public void treeQuery_honorsConfiguredExclusions() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class);
             MockedStatic<BundleUtils> mockedBundle = mockStatic(BundleUtils.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = sampleTree();
            when(session.getNode("/root", false)).thenReturn(root);
            configExcludes(mockedBundle, "/root/big");

            final JcrStatsQuery.GqlNodeStats tree = new JcrStatsQuery().tree("/root", 6);

            assertThat(tree.getSize()).as("tree query root aggregates only the non-excluded subtree").isEqualTo(100L);
            assertThat(tree.getNodeCount()).as("tree query counts only root + keep").isEqualTo(2L);
            assertThat(tree.getChildren()).as("the excluded /root/big child is gone").hasSize(1);
            assertThat(tree.getChildren().get(0).getName()).isEqualTo("keep");
        }
    }

    @Test
    public void computeAndWriteFlamegraph_honorsConfiguredExclusions() throws Exception {
        // Backs BOTH the computeSize mutation and the Karaf jcr-stats:compute-size CLI. Files is mocked
        // so the flamegraph write short-circuits (null path) and the test focuses on the totals.
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class);
             MockedStatic<BundleUtils> mockedBundle = mockStatic(BundleUtils.class);
             MockedStatic<Files> mockedFiles = mockStatic(Files.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = sampleTree();
            when(session.getNode("/root", false)).thenReturn(root);
            configExcludes(mockedBundle, "/root/big");
            mockedFiles.when(() -> Files.createTempFile(any(Path.class), anyString(), anyString()))
                    .thenThrow(new IOException("skip flamegraph write in this test"));

            final ComputeResult result = computer.computeAndWriteFlamegraph("/root", false);

            assertThat(result.getTotalSize()).as("computeSize/CLI now drop the excluded subtree").isEqualTo(100L);
            assertThat(result.getNodeCount()).as("computeSize/CLI count only root + keep").isEqualTo(2L);
        }
    }

    @Test
    public void noExclusionsConfigured_totalsUnchanged() throws Exception {
        // Behaviour-preserving guarantee: with no config service (or no exclusions), the sync surfaces
        // return exactly the pre-fix totals — the whole tree, 600 bytes / 4 nodes.
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class);
             MockedStatic<BundleUtils> mockedBundle = mockStatic(BundleUtils.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            // A fresh tree per traversal: the mock iterators are single-use, and this test runs two.
            final JCRNodeWrapper root1 = sampleTree();
            final JCRNodeWrapper root2 = sampleTree();
            when(session.getNode("/root", false)).thenReturn(root1, root2);
            // No JcrStatsConfig service available -> liveExclusions() falls back to the no-op predicate.
            mockedBundle.when(() -> BundleUtils.getOsgiService(JcrStatsConfig.class, null)).thenReturn(null);

            final Long size = new JcrStatsQuery().size("/root");
            final Long count = new JcrStatsQuery().nodeCount("/root");

            assertThat(size).as("no exclusions => identical to pre-fix full-tree size").isEqualTo(600L);
            assertThat(count).as("no exclusions => identical to pre-fix full-tree node count").isEqualTo(4L);
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
