package org.jahia.community.jcrstats;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

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
    private volatile NodeStats lastResult;
    private volatile String lastPath;
    private volatile String lastError;
    private volatile long computedAt;
    private ExecutorService executor;

    @Activate
    public void activate() {
        executor = Executors.newSingleThreadExecutor(runnable -> {
            final Thread thread = new Thread(runnable, "jcr-stats-computation");
            thread.setDaemon(true);
            return thread;
        });
    }

    @Deactivate
    public void deactivate() {
        if (executor != null) {
            executor.shutdownNow();
        }
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
        executor.submit(() -> {
            try {
                final NodeStats tree = new JcrStatsComputer().computeStats(effectivePath);
                lastResult = tree;
                lastPath = effectivePath;
                computedAt = System.currentTimeMillis();
            } catch (RepositoryException | RuntimeException e) {
                lastError = GENERIC_ERROR;
                LOGGER.error("Asynchronous JCR stats computation failed for path {}", effectivePath, e);
            } finally {
                running.set(false);
            }
        });
        return true;
    }

    public boolean isRunning() {
        return running.get();
    }

    public NodeStats getLastResult() {
        return lastResult;
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
}
