package org.jahia.community.jcrstats;

import org.jahia.community.jcrstats.graphql.JcrStatsQuery;
import org.junit.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Constructor/getter smoke tests for the immutable data carriers. These guard against accidental
 * constructor-argument reordering (the fields are all same-typed in places, so a swap would compile
 * silently) and give JaCoCo line credit for the accessor methods.
 */
public class DataCarriersTest {

    @Test
    public void computeResult_gettersReturnConstructorArgs() {
        ComputeResult result = new ComputeResult("/sites/foo", 1234L, 7L, "/path/flamegraph");

        assertThat(result.getPath()).isEqualTo("/sites/foo");
        assertThat(result.getTotalSize()).isEqualTo(1234L);
        assertThat(result.getNodeCount()).isEqualTo(7L);
        assertThat(result.getFlamegraphPath()).isEqualTo("/path/flamegraph");
    }

    @Test
    public void computeResult_nullFlamegraphPath_isPreserved() {
        ComputeResult result = new ComputeResult("/", 0L, 1L, null);
        assertThat(result.getFlamegraphPath()).isNull();
    }

    @Test
    public void gqlJcrStatsStatus_gettersReturnConstructorArgs() {
        JcrStatsQuery.GqlJcrStatsStatus status =
                new JcrStatsQuery.GqlJcrStatsStatus(true, "/sites/bar", "boom", false, 100L, 250L, 42L);

        assertThat(status.isRunning()).isTrue();
        assertThat(status.getPath()).isEqualTo("/sites/bar");
        assertThat(status.getError()).isEqualTo("boom");
        assertThat(status.isHasResult()).isFalse();
        assertThat(status.getStartedAt()).isEqualTo(100L);
        assertThat(status.getElapsedMs()).isEqualTo(250L);
        assertThat(status.getVisitedCount()).isEqualTo(42L);
    }

    @Test
    public void gqlJcrStatsStatus_emptyState_matchesNoServiceSentinel() {
        // Mirrors the sentinel built when the service is unavailable.
        JcrStatsQuery.GqlJcrStatsStatus status =
                new JcrStatsQuery.GqlJcrStatsStatus(false, null, null, false, 0L, 0L, 0L);

        assertThat(status.isRunning()).isFalse();
        assertThat(status.getPath()).isNull();
        assertThat(status.getError()).isNull();
        assertThat(status.isHasResult()).isFalse();
        assertThat(status.getStartedAt()).isZero();
        assertThat(status.getElapsedMs()).isZero();
        assertThat(status.getVisitedCount()).isZero();
    }

    @Test
    public void gqlJcrStatsReport_gettersReturnConstructorArgs() {
        JcrStatsQuery.GqlJcrStatsReport report =
                new JcrStatsQuery.GqlJcrStatsReport("/files/jcr-stats/x/flamegraph", "flamegraph", "/files/default/x");

        assertThat(report.getPath()).isEqualTo("/files/jcr-stats/x/flamegraph");
        assertThat(report.getName()).isEqualTo("flamegraph");
        assertThat(report.getUrl()).isEqualTo("/files/default/x");
    }
}
