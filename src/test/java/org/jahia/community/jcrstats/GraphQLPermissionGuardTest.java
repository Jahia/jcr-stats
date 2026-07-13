package org.jahia.community.jcrstats;

import graphql.annotations.annotationTypes.GraphQLField;
import org.jahia.community.jcrstats.graphql.JcrStatsMutation;
import org.jahia.community.jcrstats.graphql.JcrStatsQuery;
import org.jahia.modules.graphql.provider.dxm.security.GraphQLRequiresPermission;
import org.junit.Test;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * F33 schema-consistency guard: every top-level GraphQL operation on {@link JcrStatsQuery} and
 * {@link JcrStatsMutation} MUST be gated by {@code @GraphQLRequiresPermission("jcrStatsAdmin")}.
 *
 * <p>This is a security regression guard: if a future field is added without the permission
 * annotation it ships ungated, exposing the (ACL-bypassing) JCR stats engine to any authenticated
 * caller. The test fails the build in that case.</p>
 *
 * <p>Scope note (avoids a false positive): only the <em>own declared methods</em> of the two
 * resolver classes are inspected. The nested DTO classes ({@code GqlNodeStats},
 * {@code GqlJcrStatsStatus}, {@code GqlJcrStatsReport}, {@code GqlJcrStatsComputeResult}) also carry
 * {@code @GraphQLField} getters that correctly have <em>no</em> permission — a naive walk over inner
 * classes would wrongly flag them.</p>
 */
public class GraphQLPermissionGuardTest {

    private static final String REQUIRED_PERMISSION = "jcrStatsAdmin";

    @Test
    public void everyQueryField_isGatedByJcrStatsAdmin() {
        assertAllFieldsGated(JcrStatsQuery.class);
    }

    @Test
    public void everyMutationField_isGatedByJcrStatsAdmin() {
        assertAllFieldsGated(JcrStatsMutation.class);
    }

    @Test
    public void guardActuallyFindsTheDeclaredOperations() {
        // Sanity: the reflection walk is not silently matching zero methods (which would make the
        // gating assertions vacuously pass). The two resolver classes expose the documented count of
        // top-level operations (8 queries + 7 mutations).
        assertThat(gatedFieldNames(JcrStatsQuery.class))
                .containsExactlyInAnyOrder("size", "nodeCount", "tree", "status", "result",
                        "exclusions", "reports", "snapshots");
        assertThat(gatedFieldNames(JcrStatsMutation.class))
                .containsExactlyInAnyOrder("compute", "cancel", "saveSnapshot", "deleteSnapshot",
                        "addExclusion", "removeExclusion", "computeSize");
    }

    private static void assertAllFieldsGated(Class<?> resolver) {
        for (Method method : resolver.getDeclaredMethods()) {
            if (!method.isAnnotationPresent(GraphQLField.class)) {
                continue;
            }
            final GraphQLRequiresPermission permission = method.getAnnotation(GraphQLRequiresPermission.class);
            assertThat(permission)
                    .as("%s.%s is a @GraphQLField but carries no @GraphQLRequiresPermission — it would ship ungated",
                            resolver.getSimpleName(), method.getName())
                    .isNotNull();
            assertThat(permission.value())
                    .as("%s.%s must require the '%s' permission", resolver.getSimpleName(), method.getName(),
                            REQUIRED_PERMISSION)
                    .isEqualTo(REQUIRED_PERMISSION);
        }
    }

    private static List<String> gatedFieldNames(Class<?> resolver) {
        final List<String> names = new ArrayList<>();
        for (Method method : resolver.getDeclaredMethods()) {
            if (method.isAnnotationPresent(GraphQLField.class)) {
                names.add(method.getName());
            }
        }
        return names;
    }
}
