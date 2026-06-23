# JCR Stats

A comprehensive JCR space-analysis tool for Jahia DX that visualizes and compares disk usage and node distribution across JCR subtrees. Version 2.1.2 adds path exclusions, server-side cancellation, saved execution history, and improved traversal strategies for faster analysis of large trees.

## Overview

JCR Stats helps administrators understand how disk space is distributed throughout the JCR repository. It computes aggregated size and node-count statistics for any JCR subtree, renders an interactive flame graph, displays a hierarchical tree table, lists the largest items, and enables snapshot-based comparison to detect changes over time.

### Key Capabilities

- **Interactive Flame Graph** — Click-to-zoom visualization of space usage by weight (size or node count)
- **Tree Table View** — Hierarchical breakdown with size, percentage of total, percentage of parent, and node count
- **Largest Items View** — Top-N list of space consumers
- **Snapshot Comparison** — Save/load JSON snapshots and diff against a baseline to spot growth anomalies
- **jContent Deep Links** — Direct navigation from stats results into the jContent editor
- **Flexible Metrics** — Weight by bytes or node count
- **GraphQL & Karaf APIs** — Programmatic access to statistics and computation
- **Permission-Based Access** — Configurable admin-only access via `jcrStatsAdmin` permission

---

## Admin UI

JCR Stats appears in **Jahia Administration** under **Server > System Health > JCR Stats**, accessible at the URL `/jahia/administration/jcrStats`.

### Workflow

1. **Enter a JCR Path** (defaults to `/sites`)
2. **Select "Weight by"** — either "Size" (bytes) or "Number of nodes"
3. **Click "Compute"** (or press Ctrl+Enter) — starts a background computation
   - A progress indicator appears showing elapsed time and scanned-node count
   - The computation runs on a single server-side background thread
   - Only one computation runs at a time; clicking Compute while one is already running has no effect
4. **When complete** — results appear automatically in the Flamegraph view
5. **View Results in Four Tabs:**
   - **Flamegraph** — Interactive, click to zoom in/out; hover for details (mouse-operated; keyboard users should use the Tree table)
   - **Tree table** — Scrollable, sortable hierarchy showing size, % of total, % of parent, node count (keyboard accessible)
   - **Largest items** — Top-N nodes by selected metric
   - **Comparison** — Diff view against a previously saved baseline

**Resume-on-Remount:** If you navigate away from the JCR Stats page while a computation is running and then return, the progress display resumes from the server's live status (elapsed time and visited count).

### Path Exclusions

Paths can be excluded from the computation — excluded paths and their entire subtrees are skipped during traversal. To exclude a path:

1. Click on a frame in the **Flamegraph** view
2. Choose **Exclude this path** from the context menu
3. The path is added to the exclusions list (shown below the Flamegraph)
4. Click **Remove** next to an excluded path to include it again

Exclusions are persisted as an OSGi configuration file in the Karaf `etc` directory and survive server restarts. Administrators can also edit the file directly at `${karaf.etc}/org.jahia.community.jcrstats.cfg` using the property `jcrStats.excludedPaths` (comma or newline-separated absolute paths). The file is created on first exclusion if it does not already exist.

**Path validation:** Paths must be absolute (starting with `/`), and invalid characters (control characters, bare commas/whitespace, relative path sequences like `..`) are rejected. Exclusions take effect on the next computation.

### Server-Side Cancellation

A running computation can be cancelled from the UI or via the `jcrStats.cancel` mutation. When cancel is requested, the traversal polls a cancellation flag at the start of every node and stops gracefully between nodes — it never interrupts a JCR operation mid-stream. The `jcrStats.status` query includes a `cancelled` flag indicating whether the last run ended because it was cancelled (as opposed to completing or failing).

### UI Controls

| Control | Purpose |
|---------|---------|
| Path input | Enter JCR path to analyze (e.g., `/sites/digital`, `/`) |
| Weight by dropdown | Switch between "Size (bytes)" and "Number of nodes" |
| Compute button | Submit analysis (or Ctrl+Enter) |
| Cancel button | Stop a running computation |
| Flamegraph tab | Visualize hierarchy; click a frame to zoom, breadcrumb to zoom out; click to exclude a path from future runs |
| Tree table tab | Browse complete tree with statistics |
| Largest items tab | Sorted list of top-N nodes by metric |
| Comparison tab | Load a baseline snapshot and view differences |
| Saved Executions tab | View the history of auto-saved computation results; click View to reload a run, or Compare to use as a baseline for diff |
| Download button (flamegraph tab) | Save current snapshot as JSON |
| Upload button | Load a previously saved snapshot |
| Exclusions list | Shows excluded paths; click Remove to unexclude |

### Save & Load Snapshots

#### Auto-Save and Saved Executions History

Every completed asynchronous computation is automatically saved as a JSON snapshot in the JCR at `/sites/systemsite/files/jcr-stats/snapshots/jcr-stats-<timestamp>.json`. The **Saved Executions** list displays these snapshots in reverse chronological order (most recent first). From this list, you can:
- **View** — Reload a past computation's flamegraph into the UI
- **Compare** — Load a past computation as the baseline for the comparison/diff view

When you upload a snapshot using the **Upload** button, it is automatically persisted as a new entry in the saved executions history, joining the auto-saved runs.

**Snapshot Accumulation:** Snapshots accumulate in the JCR folder by default. Consider periodically pruning old snapshots manually (or consult your Jahia administrator) to manage storage.

#### Manual Download/Upload

Use the **Download** button to save the current tree data as a JSON file (`jcr-stats-flamegraph-*.json`). The comparison view lets you load a baseline snapshot (either from saved executions or via file upload) and see side-by-side diffs highlighting growth, shrinkage, and newly added paths.

---

## GraphQL API

All operations require the `jcrStatsAdmin` permission and are located under the `jcrStats` root namespace.

**Endpoint:** `POST /modules/graphql`  
**Authentication:** Required (Jahia session)

### Queries

#### `jcrStats.size(path: String): Long`

Returns the aggregated disk size (in bytes) of the subtree at the given path. Returns `-1` on error. Read-only; safe to call frequently.

```graphql
query {
  jcrStats {
    size(path: "/sites/digital")
  }
}
```

Response:
```json
{
  "data": {
    "jcrStats": {
      "size": 1048576
    }
  }
}
```

#### `jcrStats.nodeCount(path: String): Long`

Returns the total number of nodes (root included) under the given path. Returns `-1` on error.

```graphql
query {
  jcrStats {
    nodeCount(path: "/sites/digital")
  }
}
```

#### `jcrStats.tree(path: String, maxDepth: Int): JcrStatsNode`

Returns a size-weighted recursive node tree suitable for client-side flame graph rendering. Sizes are fully aggregated; children are pruned below `maxDepth` to bound the response payload.

**Arguments:**
- `path` (optional, default `/`) — JCR path to analyze
- `maxDepth` (optional, default `6`) — Maximum child nesting depth

**Returns `JcrStatsNode`:**
- `name: String!` — Node name (last path segment, or ROOT)
- `path: String!` — Full JCR path
- `size: Long!` — Aggregated bytes of this node and descendants
- `nodeCount: Long!` — Total nodes in subtree (root included)
- `children: [JcrStatsNode!]!` — Child nodes, sorted by size descending; empty once maxDepth is reached

```graphql
query getTree($path: String, $maxDepth: Int) {
  jcrStats {
    tree(path: $path, maxDepth: $maxDepth) {
      name
      path
      size
      nodeCount
      children {
        name
        path
        size
        nodeCount
        children {
          name
          path
          size
          nodeCount
        }
      }
    }
  }
}
```

Query variables:
```json
{
  "path": "/sites",
  "maxDepth": 6
}
```

#### `jcrStats.status(): JcrStatsStatus!`

Returns the current status of any running or recently-completed asynchronous computation. Use this to poll while a computation is in progress.

**Returns `JcrStatsStatus`:**
- `running: Boolean!` — Whether a computation is currently in progress
- `path: String` — JCR path of the last (or in-progress) computation (null if none yet)
- `error: String` — Error message if the last computation failed (null on success)
- `hasResult: Boolean!` — Whether a cached result is ready to fetch via `result()`
- `startedAt: Long!` — Epoch milliseconds when the current/last computation started (0 if none yet)
- `elapsedMs: Long!` — Elapsed time in milliseconds: live while running, otherwise the duration of the last run
- `visitedCount: Long!` — Number of nodes visited so far (live progress; no total is known up front)
- `cancelled: Boolean!` — Whether the last/current run ended because it was cancelled (rather than completing or failing)

```graphql
query {
  jcrStats {
    status {
      running
      elapsedMs
      visitedCount
      hasResult
      error
    }
  }
}
```

#### `jcrStats.result(maxDepth: Int): JcrStatsNode`

Returns the tree from the last asynchronous computation, pruned to `maxDepth`. Returns `null` if no result is available yet. Call this after `status()` reports `hasResult: true` and `running: false`.

**Arguments:**
- `maxDepth` (optional, default `6`) — Maximum child nesting depth

**Returns `JcrStatsNode`:** (same structure as `tree()`)

```graphql
query {
  jcrStats {
    result(maxDepth: 6) {
      name
      path
      size
      nodeCount
      children { ... }
    }
  }
}
```

#### `jcrStats.exclusions(): [String!]!`

Returns the list of currently excluded paths. Paths in this list (and their entire subtrees) are skipped during computation.

```graphql
query {
  jcrStats {
    exclusions
  }
}
```

Response:
```json
{
  "data": {
    "jcrStats": {
      "exclusions": ["/sites/archive", "/jcr:system"]
    }
  }
}
```

#### `jcrStats.snapshots(): [JcrStatsSnapshot!]!`

Returns the list of saved execution snapshots stored in `/sites/systemsite/files/jcr-stats/snapshots/`, in reverse chronological order (most recent first).

**Returns `JcrStatsSnapshot`:**
- `path: String!` — JCR path of the snapshot JSON file
- `name: String!` — File name
- `timestamp: Long!` — Epoch milliseconds when the snapshot was created
- `computedPath: String!` — The JCR path that was analysed
- `totalSize: Long!` — Aggregated bytes of the subtree
- `nodeCount: Long!` — Total nodes in the snapshot

#### `jcrStats.reports(): [JcrStatsReport!]!`

Lists all generated flamegraph files stored in `/sites/systemsite/files/jcr-stats`.

**Returns `JcrStatsReport`:**
- `path: String!` — JCR path of the flamegraph file node
- `name: String!` — Node name
- `url: String!` — Browser URL to view the flamegraph

### Mutations

#### `jcrStats.compute(path: String): Boolean`

Starts an asynchronous computation of the subtree at the given path. Returns `false` if a computation is already running (fire-and-forget, non-blocking). Poll `status()` to track progress, then read `result()` when the computation finishes.

**Arguments:**
- `path` (optional, default `/`) — JCR path to compute

**Returns:** `Boolean!` — `true` if the job was started; `false` if one was already running

```graphql
mutation {
  jcrStats {
    compute(path: "/sites/digital")
  }
}
```

Response on success:
```json
{
  "data": {
    "jcrStats": {
      "compute": true
    }
  }
}
```

Response when a job is already running (no-op):
```json
{
  "data": {
    "jcrStats": {
      "compute": false
    }
  }
}
```

**Polling Pattern:**

1. Call `compute(path)` → returns `true` (job started) or `false` (already running)
2. Poll `status()` every 2–5 seconds; display `elapsedMs` and `visitedCount` in the UI
3. When `status()` reports `running: false` and `hasResult: true`, call `result(maxDepth)` to fetch the tree
4. Render the results

#### `jcrStats.cancel(): Boolean`

Stops a running computation gracefully. The traversal polls the cancellation flag at the start of every node and stops between nodes (never mid-JCR-operation). Returns `true` if a computation was in progress and cancellation was requested; `false` if no computation was running.

```graphql
mutation {
  jcrStats {
    cancel
  }
}
```

#### `jcrStats.addExclusion(path: String): Boolean`

Adds a path to the exclusion list. Returns `true` if the path was added successfully; `false` if it was already excluded. Excluded paths are persisted in the OSGi configuration file. The exclusion takes effect on the next computation.

**Arguments:**
- `path` (required) — Absolute JCR path to exclude (e.g., `/sites/archive`)

```graphql
mutation {
  jcrStats {
    addExclusion(path: "/sites/archive")
  }
}
```

#### `jcrStats.removeExclusion(path: String): Boolean`

Removes a path from the exclusion list. Returns `true` if the path was removed; `false` if it was not in the list.

```graphql
mutation {
  jcrStats {
    removeExclusion(path: "/sites/archive")
  }
}
```

#### `jcrStats.saveSnapshot(name: String): Boolean`

Saves the current (or most recently computed) tree as a JSON snapshot in the JCR at `/sites/systemsite/files/jcr-stats/snapshots/<name>.json`. Returns `true` on success.

**Arguments:**
- `name` (required) — Base name for the snapshot file (timestamp is auto-appended)

#### `jcrStats.deleteSnapshot(path: String): Boolean`

Deletes a saved snapshot file from the JCR. Returns `true` on success; `false` if the snapshot does not exist.

**Arguments:**
- `path` (required) — Full JCR path of the snapshot file to delete

#### `jcrStats.computeSize(path: String, deleteTemporaryFile: Boolean): JcrStatsComputeResult`

Computes the size of the subtree, writes the flamegraph HTML file to the JCR at `/sites/systemsite/files/jcr-stats`, and returns the result. Returns `null` on error.

**Arguments:**
- `path` (optional, default `/`) — JCR path to analyze
- `deleteTemporaryFile` (optional, default `false`) — Delete the temporary HTML file after uploading to the JCR

**Returns `JcrStatsComputeResult`:**
- `path: String!` — The JCR path that was computed
- `totalSize: Long!` — Aggregated bytes of the subtree
- `nodeCount: Long!` — Total nodes counted (root included)
- `flamegraphPath: String` — JCR path of the generated flamegraph file (null if not written)
- `flamegraphUrl: String` — Browser URL to view the flamegraph (null if not written)

```graphql
mutation computeSize($path: String, $deleteTemporaryFile: Boolean) {
  jcrStats {
    computeSize(path: $path, deleteTemporaryFile: $deleteTemporaryFile) {
      path
      totalSize
      nodeCount
      flamegraphPath
      flamegraphUrl
    }
  }
}
```

Mutation variables:
```json
{
  "path": "/sites/digital",
  "deleteTemporaryFile": false
}
```

Response:
```json
{
  "data": {
    "jcrStats": {
      "computeSize": {
        "path": "/sites/digital",
        "totalSize": 5242880,
        "nodeCount": 1024,
        "flamegraphPath": "/sites/systemsite/files/jcr-stats/jcr-stats-2024-01-15-14-30-45.html",
        "flamegraphUrl": "/jahia/modules/jcr-stats/flamegraph?path=..."
      }
    }
  }
}
```

---

## Karaf Command

The Karaf command shares the same analysis engine as the GraphQL API and admin UI, ensuring consistent results.

### `jcr-stats:compute-size`

Computes the size recursively and writes a flamegraph HTML file.

**Options:**

| Option | Alias | Mandatory | Default | Description |
|--------|-------|:---------:|---------|-------------|
| `-p` | `--path` | No | `/` | JCR path to compute |
| `-d` | `--delete-temporary-file` | No | `false` | Delete temporary file after uploading to JCR |

**Example:**

```bash
jcr-stats:compute-size -p /sites/digital
```

**Output:**

```
Computed 1024 node(s) under /sites/digital totalling 5 MB (flamegraph: /sites/systemsite/files/jcr-stats/jcr-stats-2024-01-15-14-30-45.html)
```

The flamegraph HTML is stored in the JCR at `/sites/systemsite/files/jcr-stats` and also in the Tomcat temporary directory (typically `$CATALINA_TMPDIR`). Use `-d` to clean up the temporary file after upload.

---

## Security & Access Control

### Permission Model: Privileged System-Session Traversal

**All JCR Stats operations require the `jcrStatsAdmin` permission.** This is a fine-grained admin permission that does not grant full server administration rights.

**Important:** The `compute(path)` and `computeSize(path)` operations use a privileged system session (`JCRTemplate.doExecuteWithSystemSession`), which **bypasses node-level read ACLs**. This means that users with the `jcrStatsAdmin` permission can see the aggregated size and structure of any subtree in the JCR, regardless of per-node read permissions. This design is intentional—administrators must be able to understand the full storage footprint of the repository to manage space effectively.

**When assigning the `jcr-stats-administrator` role, treat it as granting broad visibility into the entire JCR tree structure and size metrics.**

### Permission: `jcrStatsAdmin`

The permission is defined in `src/main/import/permissions.xml` and is checked via `@GraphQLRequiresPermission("jcrStatsAdmin")` on all GraphQL operations and at the admin UI entry point.

### Role: `jcr-stats-administrator`

An assignable role that bundles:
- `administrationAccess` — Access to Jahia Administration
- `jcrStatsAdmin` — JCR Stats-specific permission

This role is defined in `src/main/import/roles.xml` with the description "Grants access to the JCR Stats administration without requiring full server administrator rights" and is marked as privileged.

**To grant access:**

1. Navigate to **Jahia Administration > Users & Roles > Roles**
2. Find or assign the `jcr-stats-administrator` role to a user or group
3. The user can then access the JCR Stats admin UI and use all GraphQL operations

---

## Configuration

### Path Exclusions (OSGi)

Path exclusions can be configured via an OSGi configuration file at `${karaf.etc}/org.jahia.community.jcrstats.cfg` with the property identifier (PID) `org.jahia.community.jcrstats`.

**Configuration Property:** `jcrStats.excludedPaths`

**Format:** A comma-separated or newline-separated list of absolute JCR paths.

**Example configuration file** (`${karaf.etc}/org.jahia.community.jcrstats.cfg`):

```properties
# Default configuration for JCR Stats module
jcrStats.excludedPaths=/sites/archive,\
    /jcr:system,\
    /sites/legacy-content
```

**Validation:**
- Paths must be absolute (start with `/`)
- Bare control characters, relative sequences (`..`), and unescaped whitespace in the middle of a path are rejected
- Invalid paths are logged and skipped

**Behavior:**
- The file is created automatically on first exclusion via the UI (if it does not already exist)
- Administrators can edit the file directly and save changes; they take effect on the next computation
- No defaults are shipped; the file only appears after the first exclusion is added

---

## Known Limitations

- **Single-JVM Job Model** — The asynchronous computation runs on a single background thread per DX node. In a clustered DX deployment, the `status()` and `result()` queries may hit different cluster nodes, and status/result data is not synchronized across nodes. Plan accordingly if you are polling across a cluster.

- **One Computation at a Time (Global)** — Only one `compute(path)` or `computeSize(path)` job runs on the entire server at any moment. Subsequent requests to start a computation while one is in progress are ignored (return `false` or `null`). Multiple administrators share the same server-wide job; they cannot run concurrent analyses.

- **In-Memory Tree Bounded by Node Count** — The full traversal result is held in memory, bounded by a hard limit of `MAX_VISITED_NODES = 5,000,000` nodes. If a subtree exceeds this limit, traversal aborts and the computation fails with an error. For very large repositories, traverse smaller subtrees (e.g., `/sites/mysite` instead of `/`) or add path exclusions.

- **Synchronous Queries on Request Thread** — The synchronous `size()`, `nodeCount()`, and `tree()` queries run on the request thread for small paths. For large subtrees, prefer the asynchronous `compute()` mutation (fire-and-forget) followed by `status()` polling.

- **Flamegraph is Mouse-Operated** — The interactive flamegraph visualization requires a mouse or touch device. Keyboard-only users should navigate using the **Tree table** view, which is fully keyboard accessible (arrow keys, Enter, Tab).

- **Snapshot Accumulation** — Saved execution snapshots accumulate in `/sites/systemsite/files/jcr-stats/snapshots/` with no automatic retention policy. Administrators should periodically prune old snapshots to manage storage.

- **Traversal Strategy** — By default, the computation walks the JCR hierarchy directly via `JCRNodeWrapper.getNodes()`, which is fast on direct trees but may skip branches whose children cannot be listed. A legacy `ISCHILDNODE` query-based strategy is available via `-DjcrStats.traversal=query` for environments with pathological JCR structures.

---

## Build & Development

### Build Module

```bash
mvn clean install
```

This builds the Java backend and compiles the React frontend using the `frontend-maven-plugin`:
- Downloads Node and Yarn
- Installs JavaScript dependencies
- Runs `yarn build:production` to bundle the React UI

### Frontend Development

The React application is located in `src/javascript/JcrStats/`.

**Components:**
- `JcrStats.jsx` — Main admin UI component (form, state, view switching, download/upload)
- `TreeTable.jsx` — Hierarchical tree table with statistics
- `TopList.jsx` — Sorted list of largest items
- `DiffTable.jsx` — Comparison/diff view
- `register.jsx` — Admin route registration

**Build the frontend:**

```bash
cd src/javascript/JcrStats
yarn install
yarn build:production
```

**Run linting:**

```bash
yarn eslint
```

The frontend uses Apollo Client for GraphQL, React Flame Graph for visualization, and Jahia Moonstone components for UI.

---

## Testing

### Unit Tests

JUnit-based tests for the computation engine:

```bash
mvn test
```

Test files:
- `src/test/java/org/jahia/community/jcrstats/JcrStatsComputerTest.java`
- `src/test/java/org/jahia/community/jcrstats/NodeStatsTest.java`

### E2E Tests

Docker-based Cypress test harness in the `tests/` directory:

```bash
cd tests
export MODULE_ID=jcr-stats
export TESTS_IMAGE=jahia/jcr-stats:latest
bash ci.build.sh       # Build the Docker image
bash ci.startup.sh     # Start containers and run Cypress
```

Tests include:
- Admin UI workflow (path input, compute, view switching)
- Snapshot save/load
- Comparison view
- GraphQL query and mutation execution

---

## Architecture

### Java Backend

**Package:** `org.jahia.community.jcrstats`

- **JcrStatsComputer** — Core traversal and flamegraph-generation engine; shared by Karaf command, GraphQL API, and admin UI
  - Methods: `computeStats(String path)`, `computeAndWriteFlamegraph(String path, boolean deleteTemporaryFile)`, `cancel()`, `getStatus()`
  
- **JcrStatsConfig** — OSGi configuration manager for path exclusions (ManagedService)
  - Reads and persists `jcrStats.excludedPaths` from `${karaf.etc}/org.jahia.community.jcrstats.cfg`
  - Provides exclusion list to JcrStatsComputer

- **JcrStatsService** — Snapshot persistence and retrieval service
  - Saves/loads JSON snapshots to `/sites/systemsite/files/jcr-stats/snapshots/`
  - Lists saved execution history

- **ComputeResult** — Immutable result value (path, totalSize, nodeCount, flamegraphPath)
- **NodeStats** — Recursive node statistics (name, path, size, nodeCount, children)
- **ComputeSizeCommand** — Karaf shell command entry point

**GraphQL Package:** `org.jahia.community.jcrstats.graphql`

- **JcrStatsQueryExtension** — Extends DXM GraphQL root Query with `jcrStats` namespace
- **JcrStatsQuery** — Query operations: `size(path)`, `nodeCount(path)`, `tree(path, maxDepth)`, `status()`, `result(maxDepth)`, `exclusions()`, `snapshots()`, `reports()`
- **JcrStatsMutationExtension** — Extends DXM GraphQL root Mutation with `jcrStats` namespace
- **JcrStatsMutation** — Mutation operations: `compute(path)`, `cancel()`, `addExclusion(path)`, `removeExclusion(path)`, `saveSnapshot(name)`, `deleteSnapshot(path)`, `computeSize(path, deleteTemporaryFile)`
- **JcrStatsGraphQLExtensionsProvider** — GraphQL extension service provider

### Frontend

**Location:** `src/javascript/JcrStats/`

- **JcrStats.jsx** — React component managing UI state, GraphQL queries, view tabs, download/upload
- **JcrStats.gql.js** — GraphQL queries and mutations (getSize, getNodeCount, getTree, getReports, computeSize)
- **jcrStatsUtils.js** — Utilities (formatBytes, metric constants, jContent URL builder)
- **TreeTable.jsx** — Recursive tree table view with sorting
- **TopList.jsx** — Top-N list view
- **DiffTable.jsx** — Comparison/diff view

### Configuration

- **pom.xml** — Maven build configuration; exports `org.jahia.community.jcrstats` package
- **src/main/import/permissions.xml** — Defines `jcrStatsAdmin` permission
- **src/main/import/roles.xml** — Defines `jcr-stats-administrator` role
- **src/main/resources/javascript/apps/bom/bom.xml** — Module metadata

---

## Versioning

**Current Version:** 2.1.2-SNAPSHOT

**Root Package:** `org.jahia.community.jcrstats`

This module follows semantic versioning and is built as an OSGi bundle for Jahia DX.

---

## Dependencies

### Java
- Jahia DX core (default, graphql-dxm-provider)
- Apache Karaf shell
- graphql-java, graphql-java-servlet, graphql-java-annotations
- JUnit 4 + AssertJ (test)

### JavaScript
- React
- Apollo Client
- React Flame Graph
- Jahia Moonstone UI components
- i18next (internationalization)

---

## Troubleshooting

### Flamegraph Not Generated

Check:
- The user has `jcrStatsAdmin` permission
- `/sites/systemsite/files/` node exists in the JCR
- Temporary directory has write permissions

### GraphQL Query Requires Permission Error

Ensure the authenticated user is assigned the `jcr-stats-administrator` role or has the `jcrStatsAdmin` permission explicitly granted.

### Large Paths Take a Long Time to Compute

Consider:
- Starting with a smaller subtree (e.g., `/sites/mysite` instead of `/`)
- Increasing the Karaf session timeout if using the command
- Setting a reasonable `maxDepth` in GraphQL queries to reduce payload size

---

## License & Attribution

JCR Stats is a Jahia community module provided as-is for space analysis and administration purposes.
