package org.jahia.community.jcrstats;

import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the parts of {@link JcrStatsService} that are reachable without a live JCR
 * repository: the single-flight gate, the elapsed-time branches and the cached-result accessor.
 * Internal state is driven directly through reflection so no real traversal is triggered.
 */
public class JcrStatsServiceTest {

    private JcrStatsService service;

    @Before
    public void setUp() {
        service = new JcrStatsService();
    }

    private void setField(String name, Object value) throws Exception {
        Field f = JcrStatsService.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(service, value);
    }

    @SuppressWarnings("unchecked")
    private <T> T getField(String name) throws Exception {
        Field f = JcrStatsService.class.getDeclaredField(name);
        f.setAccessible(true);
        return (T) f.get(service);
    }

    // --- single-flight gate ---

    @Test
    public void start_whenAlreadyRunning_returnsFalseAndDoesNotReset() throws Exception {
        // Arrange: simulate a computation already in progress and a recorded error.
        AtomicBoolean running = getField("running");
        running.set(true);
        setField("lastError", "previous error");

        // Act: a second start must be rejected without touching the gate or clearing state.
        boolean started = service.start("/some/path");

        // Assert
        assertThat(started).isFalse();
        assertThat(service.isRunning()).isTrue();
        assertThat(service.getLastError())
                .as("a rejected start must not clear the previous error")
                .isEqualTo("previous error");
    }

    // --- getElapsedMs branches ---

    @Test
    public void getElapsedMs_neverStarted_returnsZero() {
        assertThat(service.getElapsedMs()).isZero();
    }

    @Test
    public void getElapsedMs_finished_returnsRunDuration() throws Exception {
        // Not running; startedAt and finishedAt both set → duration = finishedAt - startedAt.
        ((AtomicBoolean) getField("running")).set(false);
        setField("startedAt", 1_000L);
        setField("finishedAt", 1_250L);

        assertThat(service.getElapsedMs()).isEqualTo(250L);
    }

    @Test
    public void getElapsedMs_runningWithFutureStart_isClampedToZero() throws Exception {
        // Running and startedAt in the future → Math.max(0, ...) clamps the negative delta to 0.
        ((AtomicBoolean) getField("running")).set(true);
        setField("startedAt", System.currentTimeMillis() + 60_000L);

        assertThat(service.getElapsedMs()).isZero();
    }

    @Test
    public void getElapsedMs_running_isPositiveSinceStart() throws Exception {
        ((AtomicBoolean) getField("running")).set(true);
        setField("startedAt", System.currentTimeMillis() - 500L);

        assertThat(service.getElapsedMs()).isGreaterThanOrEqualTo(500L);
    }

    // --- accessors / state ---

    @Test
    public void getLastResult_reflectsAtomicReference() throws Exception {
        AtomicReference<NodeStats> ref = getField("lastResult");
        assertThat(service.getLastResult()).isNull();

        NodeStats stats = new NodeStats("/");
        ref.set(stats);
        assertThat(service.getLastResult()).isSameAs(stats);
    }

    @Test
    public void getStartedAt_reflectsField() throws Exception {
        setField("startedAt", 4_242L);
        assertThat(service.getStartedAt()).isEqualTo(4_242L);
    }

    @Test
    public void getVisitedCount_defaultsToZero() {
        assertThat(service.getVisitedCount()).isZero();
    }

    @Test
    public void getLastPathAndError_defaultToNull() {
        assertThat(service.getLastPath()).isNull();
        assertThat(service.getLastError()).isNull();
    }

    @Test
    public void isRunning_defaultsToFalse() {
        assertThat(service.isRunning()).isFalse();
    }
}
