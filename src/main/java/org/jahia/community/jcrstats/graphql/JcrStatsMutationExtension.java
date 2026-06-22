package org.jahia.community.jcrstats.graphql;

import graphql.annotations.annotationTypes.GraphQLDescription;
import graphql.annotations.annotationTypes.GraphQLField;
import graphql.annotations.annotationTypes.GraphQLName;
import graphql.annotations.annotationTypes.GraphQLTypeExtension;
import org.jahia.modules.graphql.provider.dxm.DXGraphQLProvider;

/**
 * Adds a single {@code jcrStats} field to the root GraphQL Mutation, returning the
 * {@link JcrStatsMutation} namespace.
 */
@GraphQLTypeExtension(DXGraphQLProvider.Mutation.class)
@GraphQLDescription("JCR Stats mutations")
public class JcrStatsMutationExtension {

    private JcrStatsMutationExtension() {
    }

    @GraphQLField
    @GraphQLName("jcrStats")
    @GraphQLDescription("JCR Stats mutation namespace")
    public static JcrStatsMutation jcrStats() {
        return new JcrStatsMutation();
    }
}
