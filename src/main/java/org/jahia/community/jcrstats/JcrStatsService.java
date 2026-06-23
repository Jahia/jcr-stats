package org.jahia.community.jcrstats;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Runs JCR size computations asynchronously on a single background thread and caches the latest
 * result. A full subtree traversal can take a long time on large repositories, so the GraphQL API
 * exposes a fire-and-forget {@code compute} mutation plus {@code status}/{@code result} queries the
 * UI polls — instead of one synchronous call that would block the request until it times out.
 *
 * <p>Only one computation runs at a time; {@link #start(String)} is a no-op (returns {@code false})
 * while one is already in progress.</p>
 */
@Component(immediate = true, service = JcrStatsService.class)
public class JcrStatsService {

    private static final Logger LOGGER = LoggerFactory.getLogger(JcrStatsService.class);
    private static final String GENERIC_ERROR = "Computation failed. Check server logs for details.";

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong visited = new AtomicLong();
    // S3077: NodeStats is a mutable object; an AtomicReference publishes it safely instead of a
    // bare volatile field (volatile only guarantees visibility of the reference, not the object).
    private final AtomicReference<NodeStats> lastResult = new AtomicReference<>();
    private volatile String lastPath;
    private volatile String lastError;
    private volatile long computedAt;
    private volatile long startedAt;
    private volatile long finishedAt;
    // S3077: a volatile reference to a mutable ExecutorService is not thread-safe. Creating the
    // single-threaded executor once at construction and holding it in a final field is the correct
    // publication — final fields are safely visible to every thread without volatile.
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        final Thread thread = new Thread(runnable, "jcr-stats-computation");
        thread.setDaemon(true);
        return thread;
    });

    @Deactivate
    public void deactivate() {
        executor.shutdownNow();
    }

    /**
     * Starts an asynchronous computation of the subtree at {@code path}. Returns {@code false}
     * without starting anything if a computation is already in progress.
     */
    public boolean start(String path) {
        final String effectivePath = (path == null || path.isEmpty()) ? "/" : path;
        if (!running.compareAndSet(false, true)) {
            return false;
        }
        lastError = null;
        visited.set(0L);
        startedAt = System.currentTimeMillis();
        finishedAt = 0L;
        executor.submit(() -> {
            LOGGER.info("JCR stats computation started for path {}", effectivePath);
            try {
                final NodeStats tree = new JcrStatsComputer().computeStats(effectivePath, visited);
                lastResult.set(tree);
                lastPath = effectivePath;
                computedAt = System.currentTimeMillis();
            } catch (RepositoryException | RuntimeException e) {
                lastError = GENERIC_ERROR;
                LOGGER.error("Asynchronous JCR stats computation failed for path {}", effectivePath, e);
            } finally {
                finishedAt = System.currentTimeMillis();
                running.set(false);
                LOGGER.info("JCR stats computation finished for path {} in {} ms ({} nodes visited)",
                        effectivePath, finishedAt - startedAt, visited.get());
            }
        });
        return true;
    }

    public boolean isRunning() {
        return running.get();
    }

    public NodeStats getLastResult() {
        return lastResult.get();
    }

    public String getLastPath() {
        return lastPath;
    }

    public String getLastError() {
        return lastError;
    }

    public long getComputedAt() {
        return computedAt;
    }

    /** Epoch millis when the current/last computation started (0 if none yet). */
    public long getStartedAt() {
        return startedAt;
    }

    /** Elapsed time in ms: live while running, otherwise the duration of the last run. */
    public long getElapsedMs() {
        if (startedAt == 0L) {
            return 0L;
        }
        final long end = running.get() ? System.currentTimeMillis() : finishedAt;
        return Math.max(0L, end - startedAt);
    }

    /** Number of nodes visited so far by the current/last computation. */
    public long getVisitedCount() {
        return visited.get();
    }
}
