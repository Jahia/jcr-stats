package org.jahia.community.jcrstats.graphql;

import org.jahia.modules.graphql.provider.dxm.DXGraphQLExtensionsProvider;
import org.osgi.service.component.annotations.Component;

/**
 * Registers this bundle as a GraphQL extension provider so the DXM provider scans it for
 * {@code @GraphQLTypeExtension} classes (the jcrStats Query/Mutation namespaces).
 */
@Component(immediate = true)
public class JcrStatsGraphQLExtensionsProvider implements DXGraphQLExtensionsProvider {
}
