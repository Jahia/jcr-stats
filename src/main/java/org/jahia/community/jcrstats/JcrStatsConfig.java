package org.jahia.community.jcrstats;

import org.osgi.service.cm.ConfigurationException;
import org.osgi.service.cm.ManagedService;
import org.osgi.service.component.annotations.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Collections;
import java.util.Dictionary;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Holds the set of JCR paths excluded from computations, persisted as an OSGi configuration file.
 *
 * <p>Registered as a {@link ManagedService} under PID {@value #PID}, so Felix FileInstall delivers
 * the contents of {@code ${karaf.etc}/org.jahia.community.jcrstats.cfg} (and any later external or
 * UI-driven edit) to {@link #updated(Dictionary)}. UI edits go the other way: {@link #addExclusion}
 * / {@link #removeExclusion} rewrite that same {@code .cfg} file atomically (temp + ATOMIC_MOVE),
 * so changes survive restarts and round-trip back through {@code updated()}.</p>
 *
 * <p>Excluding a path removes that node <em>and its whole subtree</em> from the traversal. Paths are
 * stored comma-separated in the single property {@value #EXCLUDED_PATHS_KEY}; a comma is therefore
 * not a valid character in an excluded path (rejected by {@link #isValidPath}).</p>
 */
@Component(immediate = true, service = {JcrStatsConfig.class, ManagedService.class},
        property = "service.pid=" + JcrStatsConfig.PID)
public class JcrStatsConfig implements ManagedService {

    static final String PID = "org.jahia.community.jcrstats";
    static final String EXCLUDED_PATHS_KEY = "jcrStats.excludedPaths";

    private static final Logger LOGGER = LoggerFactory.getLogger(JcrStatsConfig.class);

    // Sorted, immutable snapshot; replaced atomically so the traversal always reads a consistent set.
    private final AtomicReference<Set<String>> excludedPaths = new AtomicReference<>(Collections.emptySet());

    @Override
    public void updated(Dictionary<String, ?> properties) throws ConfigurationException {
        if (properties == null) {
            excludedPaths.set(Collections.emptySet());
            return;
        }
        excludedPaths.set(parse(properties.get(EXCLUDED_PATHS_KEY)));
        LOGGER.info("JCR stats exclusions loaded: {}", excludedPaths.get());
    }

    /** Parses the comma/newline-separated property value into a sorted set of valid absolute paths. */
    static Set<String> parse(Object rawValue) {
        if (rawValue == null) {
            return Collections.emptySet();
        }
        final Set<String> parsed = new TreeSet<>();
        for (String token : rawValue.toString().split("[,\\r\\n]")) {
            final String path = token.trim();
            if (!path.isEmpty() && isValidPath(path)) {
                parsed.add(path);
            }
        }
        return Collections.unmodifiableSet(parsed);
    }

    /** The current set of excluded paths (sorted, unmodifiable). */
    public Set<String> getExcludedPaths() {
        return excludedPaths.get();
    }

    /**
     * Whether {@code path} is excluded — either an exact match or a descendant of an excluded path.
     * Cheap enough to call once per node during traversal.
     */
    public boolean isExcluded(String path) {
        if (path == null) {
            return false;
        }
        for (String excluded : excludedPaths.get()) {
            if (path.equals(excluded) || path.startsWith(excluded + "/")) {
                return true;
            }
        }
        return false;
    }

    /** Adds {@code path} to the exclusions and persists the config file. Returns false if invalid. */
    public synchronized boolean addExclusion(String path) {
        final String trimmed = path == null ? "" : path.trim();
        if (!isValidPath(trimmed)) {
            LOGGER.warn("Rejected invalid exclusion path: {}", path);
            return false;
        }
        final Set<String> next = new TreeSet<>(excludedPaths.get());
        if (!next.add(trimmed)) {
            return true; // already present — nothing to write
        }
        return persist(next);
    }

    /** Removes {@code path} from the exclusions and persists the config file. */
    public synchronized boolean removeExclusion(String path) {
        final Set<String> next = new TreeSet<>(excludedPaths.get());
        if (!next.remove(path == null ? "" : path.trim())) {
            return true; // not present — nothing to write
        }
        return persist(next);
    }

    /** Upper bound on an excluded path length; defends against pathological values in the .cfg we write. */
    static final int MAX_PATH_LENGTH = 4096;

    /**
     * Validates an excluded path: a genuine absolute JCR path — one or more {@code /segment} parts
     * where a segment is non-empty and contains neither {@code /} nor a comma (the storage separator).
     * Also bounded length, no whitespace/control characters, and free of {@code ..} segments.
     *
     * <p>Implemented with linear string checks instead of a regex: the equivalent pattern
     * {@code (/[^/,]+)+} has a nested quantifier that risks catastrophic backtracking (Sonar S5998).
     * Requiring a leading {@code /}, no empty segment ({@code //}) and no trailing {@code /} is the
     * same grammar, validated in O(n).</p>
     */
    static boolean isValidPath(String path) {
        if (path == null || path.length() < 2 || path.length() > MAX_PATH_LENGTH
                || !path.startsWith("/") || path.endsWith("/")
                || path.contains("//") || path.contains(",") || path.contains("..")) {
            return false;
        }
        for (int i = 0; i < path.length(); i++) {
            final char c = path.charAt(i);
            if (c < 0x20 || c == 0x7f) {
                return false;
            }
        }
        return true;
    }

    private boolean persist(Set<String> paths) {
        final String etc = System.getProperty("karaf.etc");
        if (etc == null || etc.isEmpty()) {
            LOGGER.error("Cannot persist JCR stats exclusions: karaf.etc system property is not set");
            return false;
        }
        final Path cfgFile = Paths.get(etc, PID + ".cfg");
        final List<String> lines = Arrays.asList(EXCLUDED_PATHS_KEY + "=" + String.join(",", paths));
        try {
            // Atomic write: a temp file in the same directory, then ATOMIC_MOVE, so FileInstall never
            // observes a half-written file. The move triggers updated(), which refreshes the in-memory
            // set; we also set it here so callers see the change without waiting for the file watcher.
            final Path tmp = Files.createTempFile(cfgFile.getParent(), PID, ".cfg.tmp");
            Files.write(tmp, lines, StandardCharsets.UTF_8);
            Files.move(tmp, cfgFile, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            excludedPaths.set(Collections.unmodifiableSet(new LinkedHashSet<>(paths)));
            LOGGER.info("JCR stats exclusions saved to {}: {}", cfgFile, paths);
            return true;
        } catch (IOException e) {
            LOGGER.error("Failed to persist JCR stats exclusions to {}", cfgFile, e);
            return false;
        }
    }
}
