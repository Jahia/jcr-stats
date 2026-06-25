# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.2] — Unreleased

### Added

- **Saved executions (server-side JSON history)** — Every completed asynchronous computation is automatically saved as a JSON snapshot in the JCR (`/sites/systemsite/files/jcr-stats/snapshots/jcr-stats-<timestamp>.json`), so a past run's flamegraph can be reopened later by anyone — including after a restart. A **Saved executions** list shows the history (most recent first) with **View** (reload a run into the viewer) and **Compare** (load a run as the comparison baseline) actions — so two saved executions can be diffed in the existing Comparison view. New GraphQL query `jcrStats.snapshots`. The snapshot uses the same envelope as the manual Save/Load (depth-limited to the rendered tree). Snapshots accumulate; prune the JCR folder if needed.
- **Path exclusions** — Paths can be excluded from the computation (the path and its whole subtree are skipped). Click a frame in the flamegraph and choose **Exclude this path**; excluded paths are listed with a **Remove** control. Exclusions are persisted as an OSGi configuration file (`${karaf.etc}/org.jahia.community.jcrstats.cfg`, property `jcrStats.excludedPaths`) via a `ManagedService`, so they survive restarts and can also be edited by hand. New GraphQL ops: `jcrStats.exclusions` (query), `jcrStats.addExclusion(path)` / `jcrStats.removeExclusion(path)` (mutations). Exclusions take effect on the next computation.
- **Server-side cancellation** — New `jcrStats.cancel` mutation and a `cancelled` flag on `jcrStats.status`. The traversal now polls a cooperative cancellation flag at the start of every node, so a running job stops between nodes (never mid-JCR-operation).

### Changed

- **Unified data store / simpler comparison UI** — **Load data** now also stores the loaded file as a server snapshot (new `jcrStats.saveSnapshot` mutation), so loaded data joins the **Saved executions** history like a computed run. The standalone **Compare with…** button (file-based baseline upload) was removed — comparison is now driven from the Saved executions list (**View** one run, **Compare** another). The diff view itself is unchanged.

### Fixed

- **The "Cancel" button now actually stops the computation** — Previously it only stopped client-side polling while the server job kept running to completion (the message even said so). It now calls `jcrStats.cancel`, which stops the server-side traversal; the UI reports "Computation cancelled."
- **Whole-site traversal no longer aborts on un-listable branches** — Walking a subtree that descends into an external data-source mount whose child names are not valid JCR paths (e.g. `cloud-dumps` nodes named with an ISO-8601 timestamp, where `:` is the namespace-prefix separator) raised `RepositoryException: Invalid path … ':' not valid name character` from the eager `getNodes()` listing and aborted the entire computation. When direct listing fails, the traversal now falls back to an `ISCHILDNODE` query whose path is escaped via `JCRContentUtils.sqlEncode`, recovering the valid children of that node instead of dropping the whole branch (the single un-representable node — which cannot be a JCR node at all — is simply omitted). A `WARN` is logged; only if the escaped query also fails is the node's subtree skipped. The hard `MAX_VISITED_NODES` safety limit still aborts as before.

#### Review hardening (multi-dimensional blind review)

- **Snapshot/flamegraph writes use a dedicated system session** via `JCRTemplate.doExecuteWithSystemSession` instead of the request-bound `getCurrentSystemSession`, fixing a thread-safety/lifecycle hazard when writing from the background computation thread.
- **Cancellation classified by exception type** (`CancelledException`) rather than a flag, so a genuine error occurring after a cancel request is no longer mis-logged as a clean cancel.
- **Flamegraph HTML write aborts on a failed header/footer** instead of uploading a half-written file.
- **`jsonEscape` now escapes lone UTF-16 surrogates**; `jcr:data` length reads guard against multi-valued properties; `exportedAt` uses UTC `Instant`.
- **Accessibility (WCAG 2.2 AAA):** focus is no longer relocated on async completion (only on user-initiated view changes); the reduced-motion override fully stops the progress-bar animation; info/success use `role="status"` (errors keep `role="alert"`); icon/list buttons have descriptive accessible names; the flamegraph uses `role="img"`; progressbar exposes `aria-valuemin/max`; heading reflows at 400% zoom; border/link colours raised to AAA contrast.
- **Frontend correctness:** a stale previous-run status can no longer apply its result to a new run (guarded by `startedAt`/a generation counter); the saved-executions refetch is scoped to successful computations; load-as-snapshot failures surface to the user.
- **Reliability:** replaced a backtracking-prone path-validation regex with linear string checks (Sonar S5998).

### Changed

- **Saved executions list** now shows each run's date and size, with a per-row **Delete**; snapshots are capped at the 50 most recent (oldest pruned on write). "Compare" is disabled until a current result is loaded, and loading a file states it was saved to history.

### Security

- **`saveSnapshot` validates the uploaded envelope structurally** (parsed JSON object with `format == jcr-stats-flamegraph` and a `tree`) instead of a substring match; **`deleteSnapshot` only deletes within the snapshots folder**; excluded-path validation adds a length cap and stricter absolute-path checks.

### Tests

- Added regression tests to `JcrStatsTraversalTest`: a node whose children cannot be listed at all is skipped (no exception propagates), a single failing child no longer drops its siblings, and the escaped-query fallback recovers valid children when direct listing fails.
- Raised coverage across the backend (`saveSnapshot` validation, `cancel`/`isLastRunCancelled`, `jsonEscape`/`buildSnapshotJson` edge cases, exclusion edge cases) and the frontend (the `handlePolledStatus`/`applyComputedResult` controller, status edge cases) — 87 Java + 106 JS tests. New Cypress specs cover the cancel, snapshot View/Compare/Delete, and exclusion flows.

---

## [2.1.1] — 2026-06-23

### Changed

- **Tree Traversal Strategy** — The size computation now walks the JCR hierarchy directly via `JCRNodeWrapper.getNodes()` instead of firing one `ISCHILDNODE` JCR-SQL2 query per node. This removes a per-node query parse/plan/index lookup plus a redundant path resolution, making large-subtree computations substantially faster, and reads committed hierarchy state instead of possibly-lagging Lucene index state. The legacy query-based strategy remains available for A/B benchmarking via the `-DjcrStats.traversal=query` system property (default: `direct`).
- **Session Refresh** — `session.refresh(false)` now runs once at the start of a traversal instead of once per node (the per-node refresh was needless overhead on a read-only walk).

### Tests

- Added `JcrStatsTraversalTest` covering the direct-traversal aggregation logic (size roll-up, node count, single-visit guarantee, size-descending child ordering) with mocked `JCRNodeWrapper`s; introduced a `test`-scoped Mockito dependency.

---

## [2.1.0] — 2026-06-23

### Added

- **GraphQL API** — New `jcrStats` namespace under root Query and Mutation, supporting:
  - Query operations: `size(path)`, `nodeCount(path)`, `tree(path, maxDepth)`, `status()`, `result(maxDepth)`, `reports()`
  - Mutations: `compute(path)` (fire-and-forget async start), `computeSize(path, deleteTemporaryFile)` (synchronous full flamegraph)
  - All operations require `jcrStatsAdmin` permission
  - Recursive node tree with depth limiting for efficient payload size

- **Asynchronous Computation** — Background job model for large subtree traversal:
  - `compute(path)` mutation starts a single server-wide background job (no-op if one is already running)
  - `status()` query returns live progress: running flag, elapsed time (ms), visited node count, path, error state
  - `result(maxDepth)` query returns the cached tree once computation completes
  - Client-side polling pattern: fire compute, poll status every 2s, fetch result on completion
  - Progress UI shows elapsed timer and scanned-node counter
  - Resume-on-remount: navigating away from the page and back resumes status display of a still-running job

- **React Admin UI** — Interactive space analysis interface at `/jahia/administration/jcrStats`:
  - **Flamegraph View** — Click-to-zoom interactive visualization of space usage; keyboard hint advises use of Tree table for keyboard access
  - **Tree Table View** — Hierarchical breakdown with columns for size, % of total, % of parent, and node count; fully keyboard accessible
  - **Largest Items View** — Sorted top-N list of space consumers
  - **Comparison View** — Snapshot diff to track space changes over time
  - **Progress Indicator** — While computing: animated loader + elapsed timer + live scanned-node count
  - **Snapshot Save/Load** — Download current tree as JSON; upload previously saved snapshots; load baselines for comparison

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
- **Administration Menu** — Merged the two-level "JCR Statistics → Compute size" navigation into a single selectable **JCR Statistics** entry under System Health (route `jcrStats`); removed the redundant intermediate group
- **Job Logging** — The asynchronous computation now emits `INFO` log lines when a job starts and when it finishes (with elapsed time and visited-node count)

### Deprecated

- Direct use of ComputeSizeCommand for programmatic access; use GraphQL API or JcrStatsComputer instead

### Fixed

- Defensive node-count traversal cap prevents unbounded memory use on pathologically large trees
- Hardened JSON-import validation for snapshot upload (strict schema enforcement)

### Security

- All GraphQL operations validate `jcrStatsAdmin` permission at execution time
- **JCR traversal uses a privileged system session**: The `compute(path)` and `computeSize(path)` operations use `JCRTemplate.doExecuteWithSystemSession`, which bypasses node-level read ACLs. Consequently, holding the `jcrStatsAdmin` permission grants full-repository structural/size visibility regardless of per-node JCR read permissions. This is intentional—administrators need to understand the full storage footprint. When assigning the `jcr-stats-administrator` role, treat it as granting broad read-visibility into the entire JCR tree.
- Flamegraph HTML files are generated with safe, non-executable content
- Input validation on path parameters; JCR node traversal bounded by configurable depth limit

---

## [2.0.x] — Earlier

Earlier releases provided only the Karaf `jcr-stats:compute-size` command. Detailed changelog not maintained.

---

## Notes

- **MAX_DEPTH Coupling** — The flame graph depth limit is set to 6 levels and is hardcoded in four places that must stay in sync: `JcrStatsQuery.DEFAULT_MAX_DEPTH`, `JcrStatsComputer.SNAPSHOT_MAX_DEPTH`, the `MAX_DEPTH` constant in `jcrStatsController.js`, and the GraphQL `getTree` query nesting structure (6 levels of `children { ... }`). When changing this value, update all four locations.

- **Flamegraph Storage** — Generated HTML files are persisted at `/sites/systemsite/files/jcr-stats/` in the JCR for archival and later comparison.

- **Permission Model** — The `jcrStatsAdmin` permission is intentionally granular to allow access without granting full server administration rights. Assign the `jcr-stats-administrator` role for convenient management.

- **Backward Compatibility** — The Karaf `jcr-stats:compute-size` command is maintained for CLI users. The GraphQL API is the recommended programmatic interface for new integrations.
