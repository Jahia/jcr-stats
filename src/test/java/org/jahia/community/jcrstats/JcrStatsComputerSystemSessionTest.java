package org.jahia.community.jcrstats;

import org.apache.jackrabbit.JcrConstants;
import org.jahia.services.content.JCRCallback;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRPropertyWrapper;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.content.JCRTemplate;
import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tests for the {@link JcrStatsComputer} paths that run inside the static
 * {@code JCRTemplate.getInstance().doExecuteWithSystemSession(...)} system session (an intentional
 * ACL bypass) and the static {@code Files.createTempFile(...)} call. These require the inline
 * mock-maker (see {@code mockito-inline} in the pom) — the default subclass mock-maker cannot mock
 * static methods.
 *
 * <p>Every test drives the real production callback against a mocked {@link JCRSessionWrapper}: the
 * {@code doExecuteWithSystemSession} stub simply invokes the supplied {@link JCRCallback} with the
 * mock session, so the code under test runs exactly as it would against a live repository.</p>
 */
public class JcrStatsComputerSystemSessionTest {

    private final JcrStatsComputer computer = new JcrStatsComputer();

    /** Wires {@code mockedTemplate} so doExecuteWithSystemSession(cb) runs {@code cb} against {@code session}. */
    private static void runCallbacksAgainst(MockedStatic<JCRTemplate> mockedTemplate, JCRSessionWrapper session)
            throws Exception {
        final JCRTemplate template = mock(JCRTemplate.class);
        mockedTemplate.when(JCRTemplate::getInstance).thenReturn(template);
        when(template.doExecuteWithSystemSession(any(JCRCallback.class)))
                .thenAnswer(inv -> ((JCRCallback<?>) inv.getArgument(0)).doInJCR(session));
    }

    // --- F35 / U1(engine): computeStats routes through the system session (ACL bypass) ---

    @Test
    public void computeStats_routesThroughSystemSession_andAggregatesSubtree() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            // A two-node subtree the traversal reads via the privileged system session.
            final JCRNodeWrapper leaf = leaf("/content/big/file", 4096L);
            final JCRNodeWrapper root = branch("/content/big", leaf);
            when(session.getNode("/content/big", false)).thenReturn(root);

            final NodeStats stats = computer.computeStats("/content/big");

            assertThat(stats.getSize()).isEqualTo(4096L);
            assertThat(stats.getNodeCount()).isEqualTo(2L);
            // The read went through the privileged system session, not the caller's session — the
            // documented ACL bypass. (It stays gated by @GraphQLRequiresPermission at the resolver.)
            final JCRTemplate template = JCRTemplate.getInstance();
            verify(template).doExecuteWithSystemSession(any(JCRCallback.class));
            verify(session).refresh(false);
        }
    }

    // --- U4 + D2: saveSnapshot stores under a server-generated jcr-stats-<timestamp>.json name ---

    @Test
    public void saveSnapshot_storesUnderServerGeneratedTimestampName_ignoringPayloadContent() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper folder = selfReturningFolder(JcrStatsComputer.SNAPSHOTS_PATH);
            when(session.getRootNode()).thenReturn(folder);
            // Prune re-fetches the folder; keep it small so nothing is pruned.
            final JCRNodeWrapper snapshotsFolder = folderWithChildren();
            when(session.getNode(JcrStatsComputer.SNAPSHOTS_PATH)).thenReturn(snapshotsFolder);

            // The caller supplies only JSON content (there is no name argument on saveSnapshot).
            final String storedPath =
                    computer.saveSnapshot("{\"format\":\"jcr-stats-flamegraph\",\"tree\":{\"name\":\"x\"}}");

            final ArgumentCaptor<String> fileName = ArgumentCaptor.forClass(String.class);
            verify(folder).uploadFile(fileName.capture(), any(), anyString());
            // Server-generated name: jcr-stats-<ISO-ish timestamp>.json — never derived from the payload.
            assertThat(fileName.getValue())
                    .matches("jcr-stats-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}\\.json");
            assertThat(storedPath).isEqualTo(JcrStatsComputer.SNAPSHOTS_PATH + "/" + fileName.getValue());
            verify(session).save();
        }
    }

    // --- U5: 50 MB cap on externally-supplied snapshots (reject over, accept just under) ---

    @Test
    public void saveSnapshot_overSizeCap_isRejectedBeforeAnyJcrWrite() {
        // MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024. The size guard returns null before touching the JCR,
        // so no system session is needed here. A padded string just over the cap is enough.
        final int cap = 50 * 1024 * 1024;
        final char[] pad = new char[cap + 1];
        java.util.Arrays.fill(pad, 'a');

        assertThat(computer.saveSnapshot(new String(pad)))
                .as("a payload larger than the 50 MB cap is rejected without a JCR write")
                .isNull();
    }

    @Test
    public void saveSnapshot_justUnderCapAndValid_isAccepted() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper folder = selfReturningFolder(JcrStatsComputer.SNAPSHOTS_PATH);
            when(session.getRootNode()).thenReturn(folder);
            final JCRNodeWrapper emptyFolder = folderWithChildren();
            when(session.getNode(JcrStatsComputer.SNAPSHOTS_PATH)).thenReturn(emptyFolder);

            // A small valid envelope (well under the cap) is accepted and stored.
            final String storedPath =
                    computer.saveSnapshot("{\"format\":\"jcr-stats-flamegraph\",\"tree\":{\"name\":\"ok\"}}");

            assertThat(storedPath).isNotNull().startsWith(JcrStatsComputer.SNAPSHOTS_PATH + "/jcr-stats-");
        }
    }

    // --- U6 + D1: retention prune keeps at most 50; the 51st write removes the oldest ---

    @Test
    public void storeSnapshot_with51Existing_prunesOnlyTheOldest() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper folder = selfReturningFolder(JcrStatsComputer.SNAPSHOTS_PATH);
            when(session.getRootNode()).thenReturn(folder);

            // The snapshots folder already holds 51 files (names encode an ISO-like timestamp, so lexical
            // order == chronological order). Prune must drop exactly the single oldest to get back to 50.
            final List<JCRNodeWrapper> files = new ArrayList<>();
            for (int i = 1; i <= 51; i++) {
                files.add(snapshotFile(String.format("jcr-stats-2024-01-01T00-00-00-%03d.json", i)));
            }
            final JCRNodeWrapper snapshotsFolder = folderWithChildren(files.toArray(new JCRNodeWrapper[0]));
            when(session.getNode(JcrStatsComputer.SNAPSHOTS_PATH)).thenReturn(snapshotsFolder);

            computer.saveSnapshot("{\"format\":\"jcr-stats-flamegraph\",\"tree\":{\"name\":\"new\"}}");

            // Only the lexically-first (oldest) file is removed; the newest is untouched.
            verify(files.get(0)).remove();
            verify(files.get(1), never()).remove();
            verify(files.get(50), never()).remove();
        }
    }

    @Test
    public void storeSnapshot_withExactlyCap_prunesNothing() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper folder = selfReturningFolder(JcrStatsComputer.SNAPSHOTS_PATH);
            when(session.getRootNode()).thenReturn(folder);
            final List<JCRNodeWrapper> files = new ArrayList<>();
            for (int i = 1; i <= 50; i++) {
                files.add(snapshotFile(String.format("jcr-stats-2024-01-01T00-00-00-%03d.json", i)));
            }
            final JCRNodeWrapper snapshotsFolder = folderWithChildren(files.toArray(new JCRNodeWrapper[0]));
            when(session.getNode(JcrStatsComputer.SNAPSHOTS_PATH)).thenReturn(snapshotsFolder);

            computer.saveSnapshot("{\"format\":\"jcr-stats-flamegraph\",\"tree\":{\"name\":\"new\"}}");

            for (JCRNodeWrapper file : files) {
                verify(file, never()).remove();
            }
        }
    }

    // --- D5: an unwritable temp dir yields a null flamegraph but the totals are still returned ---

    @Test
    public void computeAndWriteFlamegraph_whenTempFileFails_returnsTotalsWithNullFlamegraph() throws Exception {
        try (MockedStatic<JCRTemplate> mockedTemplate = mockStatic(JCRTemplate.class);
             MockedStatic<Files> mockedFiles = mockStatic(Files.class)) {
            final JCRSessionWrapper session = mock(JCRSessionWrapper.class);
            runCallbacksAgainst(mockedTemplate, session);
            final JCRNodeWrapper root = branch("/content", leaf("/content/f", 200L));
            when(session.getNode("/content", false)).thenReturn(root);
            // The temp flamegraph file cannot be created (unwritable java.io.tmpdir).
            mockedFiles.when(() -> Files.createTempFile(any(Path.class), anyString(), anyString()))
                    .thenThrow(new IOException("No space left on device"));

            final ComputeResult result = computer.computeAndWriteFlamegraph("/content", false);

            // Totals still computed and returned; only the flamegraph is absent (logged, not thrown).
            assertThat(result.getTotalSize()).isEqualTo(200L);
            assertThat(result.getNodeCount()).isEqualTo(2L);
            assertThat(result.getFlamegraphPath()).as("no flamegraph is written when the temp file fails").isNull();
        }
    }

    // --- node/session mock helpers ---

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

    /** A folder mock that resolves every mkdirs segment to itself and accepts uploads. */
    private static JCRNodeWrapper selfReturningFolder(String path) throws Exception {
        final JCRNodeWrapper folder = mock(JCRNodeWrapper.class);
        when(folder.getPath()).thenReturn(path);
        when(folder.hasNode(anyString())).thenReturn(true);
        when(folder.getNode(anyString())).thenReturn(folder);
        when(folder.uploadFile(anyString(), any(), anyString())).thenReturn(mock(JCRNodeWrapper.class));
        return folder;
    }

    private static JCRNodeWrapper folderWithChildren(JCRNodeWrapper... children) throws Exception {
        final JCRNodeWrapper folder = mock(JCRNodeWrapper.class);
        final JCRNodeIteratorWrapper it = iterator(children);
        when(folder.getNodes()).thenReturn(it);
        return folder;
    }

    private static JCRNodeWrapper snapshotFile(String name) throws Exception {
        final JCRNodeWrapper file = mock(JCRNodeWrapper.class);
        when(file.getName()).thenReturn(name);
        when(file.getPath()).thenReturn(JcrStatsComputer.SNAPSHOTS_PATH + "/" + name);
        return file;
    }
}
