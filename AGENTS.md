# JCR Stats — AI Agent Context

This file provides essential context for AI assistants working on the jcr-stats module.

## Module Overview

**jcr-stats** is a Jahia DX module for analyzing and visualizing JCR subtree disk usage and node distribution. It consists of a Java backend (JCR traversal engine, GraphQL API), a React admin UI, and a Karaf shell command.

**Version:** 2.1.2-SNAPSHOT  
**Root Package:** `org.jahia.community.jcrstats`  
**Module ID:** `jcr-stats`

## Entry Points

### Java Backend

**Main Package:** `org.jahia.community.jcrstats`

- `JcrStatsComputer` — Core traversal and flamegraph generation engine; shared by Karaf, GraphQL, and admin UI
  - `computeStats(String path)` — Returns NodeStats tree (read-only)
  - `computeAndWriteFlamegraph(String path, boolean deleteTemporaryFile)` — Returns ComputeResult with flamegraph HTML path
  - `cancel()` — Stops a running computation gracefully
  - `getStatus()` — Returns current JcrStatsStatus

- `JcrStatsConfig` — OSGi ManagedService for path exclusions configuration
  - Reads/writes `jcrStats.excludedPaths` from `${karaf.etc}/org.jahia.community.jcrstats.cfg`

- `JcrStatsService` — Snapshot persistence and retrieval
  - Saves snapshots to `/sites/systemsite/files/jcr-stats/snapshots/`
  - Lists saved execution history

- `ComputeResult` — Immutable result (path, totalSize, nodeCount, flamegraphPath)

- `NodeStats` — Recursive node stats (name, path, size, nodeCount, getSubNodeStats())

- `ComputeSizeCommand` — Karaf shell command (@Command scope="jcr-stats", name="compute-size")

**GraphQL Package:** `org.jahia.community.jcrstats.graphql`

- `JcrStatsQuery` — Query operations: size(path), nodeCount(path), tree(path, maxDepth), status(), result(maxDepth), exclusions(), snapshots(), reports()
  - All decorated with `@GraphQLRequiresPermission("jcrStatsAdmin")`
  - DEFAULT_MAX_DEPTH = 6 (critical: couples with frontend MAX_DEPTH in JcrStats.jsx)

- `JcrStatsMutation` — Mutations: compute(path), cancel(), addExclusion(path), removeExclusion(path), saveSnapshot(name), deleteSnapshot(path), computeSize(path, deleteTemporaryFile)

- `JcrStatsQueryExtension`, `JcrStatsMutationExtension` — Extension providers that register the above under `jcrStats` namespace root

- `GqlNodeStats`, `GqlJcrStatsReport`, `GqlJcrStatsComputeResult` — GraphQL type definitions

### Frontend

**Location:** `src/javascript/JcrStats/`

- `JcrStats.jsx` — Main admin UI component
  - Manages path input, metric selection (METRIC_SIZE vs METRIC_NODES), view tabs (flamegraph, table, largest, diff)
  - Calls GraphQL getTree query on "Compute size"
  - Handles flamegraph click-to-zoom via React Flame Graph library
  - Download/upload for snapshots
  - Baseline loading and comparison
  - **Critical constant:** MAX_DEPTH = 6 (must match JcrStatsQuery.DEFAULT_MAX_DEPTH and getTree query nesting depth)

- `register.jsx` — Admin route registration
  - Registers 'jcrStats' adminRoute at /jahia/administration/jcrStats
  - Requires jcrStatsAdmin permission

- `JcrStats.gql.js` — GraphQL operations
  - GET_TREE — query getTree($path, $maxDepth) with nested children up to 6 levels
  - COMPUTE_SIZE mutation
  - SIZE, NODE_COUNT queries
  - REPORTS query

- `TreeTable.jsx`, `TopList.jsx`, `DiffTable.jsx` — View components

- `jcrStatsUtils.js` — Utilities (formatBytes, buildJContentUrl for deep links)

### Configuration

- `pom.xml` — Maven build; exports org.jahia.community.jcrstats; frontend-maven-plugin builds React
- `src/main/import/permissions.xml` — Defines jcrStatsAdmin permission
- `src/main/import/roles.xml` — Defines jcr-stats-administrator role (grants administrationAccess + jcrStatsAdmin)

## Build & Compilation

**Full build (Java + frontend):**
```bash
mvn clean install
```

**Frontend only:**
```bash
cd src/javascript/JcrStats
yarn install
yarn build:production
```

**Frontend linting:**
```bash
yarn eslint
```

**Run unit tests:**
```bash
mvn test
```

## E2E Testing

**Docker-based Cypress harness:**
```bash
cd tests
export MODULE_ID=jcr-stats
export TESTS_IMAGE=jahia/jcr-stats:latest
bash ci.build.sh
bash ci.startup.sh
```

## Key Coupling Points

### MAX_DEPTH = 6

The flame graph tree depth is hardcoded in four places and must stay in sync:

1. **JcrStatsQuery.java**: `DEFAULT_MAX_DEPTH = 6`
2. **JcrStatsComputer.java**: `SNAPSHOT_MAX_DEPTH = 6`
3. **jcrStatsController.js**: `MAX_DEPTH = 6` (imported by JcrStats.jsx)
4. **JcrStats.gql.js**: getTree query nesting (6 levels of `children { ... }`)

If increasing max depth, update all four locations and test that response payloads and saved snapshots remain reasonable.

### jcrStatsAdmin Permission

All GraphQL operations and the admin UI entry point require `@GraphQLRequiresPermission("jcrStatsAdmin")`. The permission is defined in `src/main/import/permissions.xml`. Users must be assigned the `jcr-stats-administrator` role or have the permission explicitly granted.

### Flamegraph Files Location

Generated flamegraph HTML files are stored at `/sites/systemsite/files/jcr-stats/` in the JCR. Referenced by:
- `JcrStatsComputer.REPORTS_BASE_PATH`
- `JcrStatsQuery.REPORTS_BASE_PATH`
- Frontend download/load UI

## Common Tasks

### Adding a New Query Operation

1. Add a new `@GraphQLField` method to `JcrStatsQuery.java`
2. Decorate with `@GraphQLRequiresPermission("jcrStatsAdmin")`, `@GraphQLName`, `@GraphQLDescription`
3. Use JcrStatsComputer for traversal logic (read-only: `computeStats()`)
4. Add corresponding GraphQL fragment/query to `JcrStats.gql.js`
5. Update frontend to use the new query

### Adding a New Mutation

1. Add a new `@GraphQLField` method to `JcrStatsMutation.java`
2. Use `JcrStatsComputer.computeAndWriteFlamegraph()` for write operations
3. Return a new GqlResult type with required fields
4. Add mutation to `JcrStats.gql.js`
5. Update frontend UI to call the mutation

### Extending the Admin UI

1. Edit `src/javascript/JcrStats/JcrStats.jsx` or add a new component
2. Import Jahia Moonstone components for styling consistency
3. Call GraphQL operations via useLazyQuery hook
4. Add i18n keys to translation bundles (keys under `jcr-stats:` namespace)

### Updating the Karaf Command

1. Modify `ComputeSizeCommand.java` options if adding parameters
2. Delegate to `JcrStatsComputer` to keep logic shared
3. Test via `jcr-stats:compute-size -p /path` in Karaf console

## File Paths (Absolute)

- Source: `/home/fbourasse/Documents/SUPPORT/SUPPORT-629/jahia-repos/jcr-stats/src/`
- Tests: `/home/fbourasse/Documents/SUPPORT/SUPPORT-629/jahia-repos/jcr-stats/tests/`
- Frontend: `/home/fbourasse/Documents/SUPPORT/SUPPORT-629/jahia-repos/jcr-stats/src/javascript/JcrStats/`
- Java: `/home/fbourasse/Documents/SUPPORT/SUPPORT-629/jahia-repos/jcr-stats/src/main/java/org/jahia/community/jcrstats/`
- GraphQL: `/home/fbourasse/Documents/SUPPORT/SUPPORT-629/jahia-repos/jcr-stats/src/main/java/org/jahia/community/jcrstats/graphql/`

## Debugging Tips

- **Karaf logs**: Check `/jahia/karaf/data/log/karaf.log` for JcrStatsComputer and GraphQL errors
- **GraphQL queries**: Test via GraphQL playground at `/modules/graphql/playground` with jcrStatsAdmin permission
- **Admin UI**: Browser DevTools Network tab for GraphQL request/response inspection
- **Flamegraph rendering**: Ensure `/sites/systemsite/files/jcr-stats/` exists and contains generated HTML files

## References

- README.md — User-facing documentation
- JcrStatsComputer.java — Authoritative traversal logic
- JcrStatsQuery.java & JcrStatsMutation.java — GraphQL contract
- JcrStats.jsx — Frontend state management and view logic
