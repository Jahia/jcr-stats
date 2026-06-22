package org.jahia.community.jcrstats.graphql;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import graphql.annotations.annotationTypes.GraphQLTypeExtension;
import org.jahia.modules.graphql.provider.dxm.DXGraphQLProvider;

/**
 * Adds a single {@code jcrStats} field to the root GraphQL Query, returning the
 * {@link JcrStatsQuery} namespace. Keeping every operation under one container avoids polluting the
 * root Query and prevents cross-module field collisions.
 */
@GraphQLTypeExtension(DXGraphQLProvider.Query.class)
@GraphQLDescription("JCR Stats queries")
public class JcrStatsQueryExtension {

    private JcrStatsQueryExtension() {
    }

    @GraphQLField
    @GraphQLName("jcrStats")
    @GraphQLDescription("JCR Stats query namespace")
    public static JcrStatsQuery jcrStats() {
        return new JcrStatsQuery();
    }
}
