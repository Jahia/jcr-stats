package org.jahia.community.jcrstats;

import org.junit.Test;
import org.mockito.MockedConstruction;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * F32: the {@code jcr-stats:compute-size} Karaf command is a thin shell entry point that delegates to
 * the shared {@link JcrStatsComputer} engine.
 *
 * <p>The command constructs its computer internally ({@code new JcrStatsComputer()}), so the engine is
 * intercepted with {@code mockConstruction} (inline mock-maker) — no live JCR session and no production
 * seam are needed. The assertions verify that the {@code -p}/{@code -d} option fields are passed
 * straight through to {@code computeAndWriteFlamegraph}, and that the option defaults are {@code /} and
 * {@code false}.</p>
 */
public class ComputeSizeCommandTest {

    private static void setField(Object target, String name, Object value) throws Exception {
        final Field field = ComputeSizeCommand.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    @Test
    public void execute_delegatesGivenPathAndDeleteFlagToEngine() throws Exception {
        final ComputeSizeCommand command = new ComputeSizeCommand();
        setField(command, "path", "/sites/myPath");
        setField(command, "deleteTemporaryFile", true);
        final ComputeResult stub = new ComputeResult("/sites/myPath", 4096L, 5L, "/fg/flamegraph");

        try (MockedConstruction<JcrStatsComputer> mocked = mockConstruction(JcrStatsComputer.class,
                (mock, ctx) -> when(mock.computeAndWriteFlamegraph("/sites/myPath", true)).thenReturn(stub))) {
            final Object returnValue = command.execute();

            assertThat(returnValue).as("the command returns null (nothing to hand back to the shell)").isNull();
            assertThat(mocked.constructed()).hasSize(1);
            verify(mocked.constructed().get(0)).computeAndWriteFlamegraph("/sites/myPath", true);
        }
    }

    @Test
    public void execute_withDefaults_usesRootPathAndKeepsTemporaryFile() throws Exception {
        // No option fields set: defaults are path="/" and deleteTemporaryFile=false.
        final ComputeSizeCommand command = new ComputeSizeCommand();
        final ComputeResult stub = new ComputeResult("/", 0L, 1L, null);

        try (MockedConstruction<JcrStatsComputer> mocked = mockConstruction(JcrStatsComputer.class,
                (mock, ctx) -> when(mock.computeAndWriteFlamegraph("/", false)).thenReturn(stub))) {
            command.execute();

            verify(mocked.constructed().get(0)).computeAndWriteFlamegraph("/", false);
        }
    }
}
