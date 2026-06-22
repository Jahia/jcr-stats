# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] — Unreleased

### Added

- **GraphQL API** — New `jcrStats` namespace under root Query and Mutation, supporting:
  - Query operations: `size(path)`, `nodeCount(path)`, `tree(path, maxDepth)`, `reports()`
  - Mutation: `computeSize(path, deleteTemporaryFile)`
  - All operations require `jcrStatsAdmin` permission
  - Recursive node tree with depth limiting for efficient payload size

- **React Admin UI** — Interactive space analysis interface at `/jahia/administration/jcrStatsExecution`:
  - **Flamegraph View** — Click-to-zoom interactive visualization of space usage
  - **Tree Table View** — Hierarchical breakdown with columns for size, % of total, % of parent, and node count
  - **Largest Items View** — Sorted top-N list of space consumers
  - **Comparison View** — Snapshot diff to track space changes over time

- **Metrics** — Support for weighting analysis by:
  - **Size (bytes)** — Disk usage analysis
  - **Number of nodes** — Structure and complexity analysis

- **Snapshot Management** — Save and load analysis results:
  - Download snapshots as JSON files
  - Upload previously saved snapshots
  - Load baseline snapshots for comparison/diff view

- **jContent Deep Links** — Click-through navigation from analysis results directly into the jContent editor for selected nodes

- **JcrStatsComputer** — Reusable traversal and flamegraph-generation engine shared by:
  - Karaf shell command (`jcr-stats:compute-size`)
  - GraphQL API mutations
  - Admin UI backend operations
  - Ensures consistency across all three interfaces (DRY principle)

- **Security & Access Control**:
  - New `jcrStatsAdmin` permission (defined in `src/main/import/permissions.xml`)
  - New `jcr-stats-administrator` role (defined in `src/main/import/roles.xml`) bundling `administrationAccess` + `jcrStatsAdmin`, marked as privileged
  - All GraphQL operations and admin UI require the `jcrStatsAdmin` permission

- **Unit Tests** — Comprehensive test coverage for:
  - JcrStatsComputer traversal logic
  - NodeStats recursive structure
  - Edge cases (empty paths, large trees, permission validation)

- **E2E Tests** — Docker-based Cypress harness covering:
  - Admin UI workflow (path input, compute, view switching)
  - Snapshot save/load functionality
  - Comparison view behavior
  - GraphQL query and mutation execution

- **Frontend Build** — React application compiled via `frontend-maven-plugin`:
  - Managed Node/Yarn installation during Maven build
  - ESLint configuration for code quality
  - Production build optimization

### Changed

- **Root Package Renamed** — From `org.jahia.modules.*` to `org.jahia.community.jcrstats` (community module convention)
- **Module Type** — Declared as `system` type module in `pom.xml`
- **Karaf Command** — Refactored to delegate to `JcrStatsComputer` for shared logic

### Deprecated

- Direct use of ComputeSizeCommand for programmatic access; use GraphQL API or JcrStatsComputer instead

### Fixed

- N/A (new feature release)

### Security

- All GraphQL operations validate `jcrStatsAdmin` permission at execution time
- No hardcoded paths; JCR traversal respects node-level permissions
- Flamegraph HTML files are generated with safe, non-executable content

---

## [2.0.x] — Earlier

Earlier releases provided only the Karaf `jcr-stats:compute-size` command. Detailed changelog not maintained.

---

## Notes

- **MAX_DEPTH Coupling** — The flame graph depth limit is set to 6 levels and is hardcoded in JcrStatsQuery.DEFAULT_MAX_DEPTH, JcrStats.jsx MAX_DEPTH constant, and the GraphQL query nesting structure. When changing this value, update all three locations.

- **Flamegraph Storage** — Generated HTML files are persisted at `/sites/systemsite/files/jcr-stats/` in the JCR for archival and later comparison.

- **Permission Model** — The `jcrStatsAdmin` permission is intentionally granular to allow access without granting full server administration rights. Assign the `jcr-stats-administrator` role for convenient management.

- **Backward Compatibility** — The Karaf `jcr-stats:compute-size` command is maintained for CLI users. The GraphQL API is the recommended programmatic interface for new integrations.
