package org.jahia.community.jcrstats.graphql;

import org.apache.jackrabbit.JcrConstants;
import org.jahia.api.Constants;
import org.jahia.community.jcrstats.JcrStatsComputer;
import org.jahia.community.jcrstats.NodeStats;
import org.jahia.services.content.JCRCallback;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRPropertyWrapper;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.content.JCRTemplate;
import org.jahia.services.content.JCRWorkspaceWrapper;
import org.jahia.services.content.QueryManagerWrapper;
import org.jahia.services.query.QueryResultWrapper;
import org.jahia.services.query.QueryWrapper;
import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;

import java.util.Calendar;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tests for {@link JcrStatsQuery} resolver behaviour that runs inside the static system session:
 * <ul>
 *   <li>U1 — the synchronous {@code size}/{@code nodeCount}/{@code tree} reads route through the
 *       privileged {@code doExecuteWithSystemSession} (they bypass read ACLs, like the async job).</li>
 *   <li>U9 — {@code reports()} excludes the snapshots subfolder in its SQL; {@code snapshots()} sorts
 *       its folder listing in memory by {@code jcr:created} descending.</li>
 * </ul>
 * Requires the inline mock-maker (mockito-inline) to mock the static {@link JCRTemplate}.
 */
public class JcrStatsQueryTest {

    private final JcrStatsQuery query = new JcrStatsQuery();

    private static void runCallbacksAgainst(MockedStatic<JCRTemplate> mockedTemplate, JCRSessionWrapper session)
            throws Exception {
        final JCRTemplate template = mock(JCRTemplate.class);
        mockedTemplate.when(JCRTemplate::getInstance).thenReturn(template);
        when(template.doExecuteWithSystemSession(any(JCRCallback.class)))
                .thenAnswer(inv -> ((JCRCallback<?>) inv.getArgument(0)).doInJCR(session));
    }

    // --- U1: sync reads bypass ACLs via the system session ---

    @Test
    public void size_routesThroughSystemSession() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = leaf("/secured/file", 2048L);
            when(session.getNode("/secured/file", false)).thenReturn(root);

            final Long size = query.size("/secured/file");

            assertThat(size).isEqualTo(2048L);
            verify(JCRTemplate.getInstance()).doExecuteWithSystemSession(any(JCRCallback.class));
        }
    }

    @Test
    public void nodeCount_routesThroughSystemSession() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper child = leaf("/secured/a", 1L);
            final JCRNodeWrapper root = branch("/secured", child);
            when(session.getNode("/secured", false)).thenReturn(root);

            assertThat(query.nodeCount("/secured")).isEqualTo(2L);
            verify(JCRTemplate.getInstance()).doExecuteWithSystemSession(any(JCRCallback.class));
        }
    }

    @Test
    public void tree_routesThroughSystemSession() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = leaf("/secured/file", 512L);
            when(session.getNode("/secured/file", false)).thenReturn(root);

            final JcrStatsQuery.GqlNodeStats node = query.tree("/secured/file", 6);

            assertThat(node).isNotNull();
            assertThat(node.getSize()).isEqualTo(512L);
            verify(JCRTemplate.getInstance()).doExecuteWithSystemSession(any(JCRCallback.class));
        }
    }

    @Test
    public void size_onError_returnsMinusOneSentinel() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            when(session.getNode(anyString(), eq(false)))
                    .thenThrow(new javax.jcr.RepositoryException("boom"));

            assertThat(query.size("/broken")).isEqualTo(-1L);
        }
    }

    // --- U9: reports() excludes the snapshots subfolder in its query ---

    @Test
    public void reports_excludesSnapshotsSubfolder_inTheSql() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            when(session.nodeExists("/sites/systemsite/files/jcr-stats")).thenReturn(true);

            final QueryManagerWrapper queryManager = mock(QueryManagerWrapper.class);
            final QueryWrapper queryWrapper = mock(QueryWrapper.class);
            final QueryResultWrapper result = mock(QueryResultWrapper.class);
            final JCRNodeIteratorWrapper empty = iterator();
            when(result.getNodes()).thenReturn(empty);
            when(queryWrapper.execute()).thenReturn(result);
            when(queryManager.createQuery(anyString(), anyString())).thenReturn(queryWrapper);
            final JCRWorkspaceWrapper workspace = mock(JCRWorkspaceWrapper.class);
            when(workspace.getQueryManager()).thenReturn(queryManager);
            when(session.getWorkspace()).thenReturn(workspace);

            query.reports();

            final ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
            verify(queryManager).createQuery(sql.capture(), anyString());
            assertThat(sql.getValue())
                    .as("reports() must exclude JSON snapshots from the HTML report listing")
                    .contains("NOT ISDESCENDANTNODE")
                    .contains(JcrStatsComputer.SNAPSHOTS_PATH);
        }
    }

    // --- U9: snapshots() sorts the folder listing by jcr:created descending in memory ---

    @Test
    public void snapshots_sortsByCreatedDescendingInMemory() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            when(session.nodeExists(JcrStatsComputer.SNAPSHOTS_PATH)).thenReturn(true);

            // Insertion order oldest→newest; snapshots() must return newest first.
            final JCRNodeWrapper oldest = snapshotFile("old.json", 100L);
            final JCRNodeWrapper newest = snapshotFile("new.json", 300L);
            final JCRNodeWrapper middle = snapshotFile("mid.json", 200L);
            final JCRNodeIteratorWrapper it = iterator(oldest, newest, middle);
            final JCRNodeWrapper folder = mock(JCRNodeWrapper.class);
            when(folder.getNodes()).thenReturn(it);
            when(session.getNode(JcrStatsComputer.SNAPSHOTS_PATH)).thenReturn(folder);

            final List<JcrStatsQuery.GqlJcrStatsReport> snapshots = query.snapshots();

            assertThat(snapshots).extracting(JcrStatsQuery.GqlJcrStatsReport::getName)
                    .containsExactly("new.json", "mid.json", "old.json");
        }
    }

    // --- helpers ---

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

    private static JCRNodeWrapper snapshotFile(String name, long createdAtMillis) throws Exception {
        final JCRNodeWrapper node = mock(JCRNodeWrapper.class);
        when(node.getPath()).thenReturn(JcrStatsComputer.SNAPSHOTS_PATH + "/" + name);
        when(node.getName()).thenReturn(name);
        when(node.isNodeType("jnt:file")).thenReturn(true);
        when(node.hasProperty(Constants.JCR_CREATED)).thenReturn(true);
        final JCRPropertyWrapper created = mock(JCRPropertyWrapper.class);
        final Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(createdAtMillis);
        when(created.getDate()).thenReturn(cal);
        when(node.getProperty(Constants.JCR_CREATED)).thenReturn(created);
        // No jcr:content → fileSize returns -1, irrelevant to the ordering assertion.
        when(node.hasNode(Constants.JCR_CONTENT)).thenReturn(false);
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
