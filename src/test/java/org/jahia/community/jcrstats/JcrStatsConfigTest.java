package org.jahia.community.jcrstats;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Hashtable;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link JcrStatsConfig}: parsing, path validation, exclusion matching, and the
 * persistence round-trip. Persistence is exercised against a real temporary directory by pointing
 * the {@code karaf.etc} system property at it — no live Jahia/Karaf is required.
 */
public class JcrStatsConfigTest {

    private JcrStatsConfig config;
    private Path etcDir;
    private String previousKarafEtc;

    @Before
    public void setUp() throws IOException {
        config = new JcrStatsConfig();
        etcDir = Files.createTempDirectory("jcrstats-etc");
        previousKarafEtc = System.getProperty("karaf.etc");
        System.setProperty("karaf.etc", etcDir.toString());
    }

    @After
    public void tearDown() {
        if (previousKarafEtc == null) {
            System.clearProperty("karaf.etc");
        } else {
            System.setProperty("karaf.etc", previousKarafEtc);
        }
    }

    // --- parse ---

    @Test
    public void parse_nullOrBlank_yieldsEmptySet() {
        assertThat(JcrStatsConfig.parse(null)).isEmpty();
        assertThat(JcrStatsConfig.parse("   ")).isEmpty();
    }

    @Test
    public void parse_commaAndNewlineSeparated_keepsOnlyValidPaths() {
        // "relative" is invalid (no leading /); whitespace is trimmed; entries are sorted.
        assertThat(JcrStatsConfig.parse("/a/b,/c\n/d, relative ,/e"))
                .containsExactly("/a/b", "/c", "/d", "/e");
    }

    // --- isValidPath ---

    @Test
    public void isValidPath_acceptsAbsolute_rejectsUnsafe() {
        assertThat(JcrStatsConfig.isValidPath("/sites/foo/files")).isTrue();
        assertThat(JcrStatsConfig.isValidPath("relative")).isFalse();
        assertThat(JcrStatsConfig.isValidPath("/has,comma")).isFalse();
        assertThat(JcrStatsConfig.isValidPath("/has/../dotdot")).isFalse();
        assertThat(JcrStatsConfig.isValidPath("/has\nnewline")).isFalse();
        assertThat(JcrStatsConfig.isValidPath(null)).isFalse();
    }

    // --- isExcluded ---

    @Test
    public void isExcluded_matchesExactAndDescendants_only() throws Exception {
        config.updated(props("/sites/foo/files/cloud-dumps"));

        assertThat(config.isExcluded("/sites/foo/files/cloud-dumps")).isTrue();           // exact
        assertThat(config.isExcluded("/sites/foo/files/cloud-dumps/2026/dump")).isTrue(); // descendant
        assertThat(config.isExcluded("/sites/foo/files/cloud-dumpsXY")).isFalse();        // not a path-segment prefix
        assertThat(config.isExcluded("/sites/foo/files")).isFalse();                      // ancestor is not excluded
        assertThat(config.isExcluded(null)).isFalse();
    }

    @Test
    public void updated_nullProperties_clearsExclusions() throws Exception {
        config.updated(props("/a"));
        assertThat(config.getExcludedPaths()).containsExactly("/a");

        config.updated(null);
        assertThat(config.getExcludedPaths()).isEmpty();
    }

    // --- persistence round-trip ---

    @Test
    public void addExclusion_writesCfgFileAndUpdatesInMemory() throws IOException {
        boolean ok = config.addExclusion("/sites/foo/files/cloud-dumps");

        assertThat(ok).isTrue();
        assertThat(config.getExcludedPaths()).containsExactly("/sites/foo/files/cloud-dumps");

        Path cfg = etcDir.resolve("org.jahia.community.jcrstats.cfg");
        assertThat(cfg).exists();
        assertThat(Files.readAllLines(cfg))
                .containsExactly("jcrStats.excludedPaths=/sites/foo/files/cloud-dumps");
    }

    @Test
    public void addExclusion_invalidPath_returnsFalseAndWritesNothing() {
        assertThat(config.addExclusion("relative")).isFalse();
        assertThat(config.getExcludedPaths()).isEmpty();
        assertThat(etcDir.resolve("org.jahia.community.jcrstats.cfg")).doesNotExist();
    }

    @Test
    public void removeExclusion_dropsPathAndRewritesFile() throws IOException {
        config.addExclusion("/a");
        config.addExclusion("/b");

        assertThat(config.removeExclusion("/a")).isTrue();

        assertThat(config.getExcludedPaths()).containsExactly("/b");
        Path cfg = etcDir.resolve("org.jahia.community.jcrstats.cfg");
        assertThat(Files.readAllLines(cfg)).containsExactly("jcrStats.excludedPaths=/b");
    }

    private static Hashtable<String, Object> props(String excludedPaths) {
        final Hashtable<String, Object> table = new Hashtable<>();
        table.put(JcrStatsConfig.EXCLUDED_PATHS_KEY, excludedPaths);
        return table;
    }
}
