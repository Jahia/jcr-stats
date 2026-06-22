# JCR Stats

A comprehensive JCR space-analysis tool for Jahia DX that visualizes and compares disk usage and node distribution across JCR subtrees. Version 2.1.0 introduces an interactive admin UI, GraphQL API, and snapshot save/load/compare functionality.

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

JCR Stats appears in **Jahia Administration** under **Server > System Health > JCR Stats**, accessible at the URL `/jahia/administration/jcrStatsExecution`.

### Workflow

1. **Enter a JCR Path** (defaults to `/sites`)
2. **Select "Weight by"** — either "Size" (bytes) or "Number of nodes"
3. **Click "Compute"** (or press Ctrl+Enter) — initiates analysis
4. **View Results in Four Tabs:**
   - **Flamegraph** — Interactive, click to zoom in/out; hover for details
   - **Tree table** — Scrollable, sortable hierarchy showing size, % of total, % of parent, node count
   - **Largest items** — Top-N nodes by selected metric
   - **Comparison** — Diff view against a previously saved baseline

### UI Controls

| Control | Purpose |
|---------|---------|
| Path input | Enter JCR path to analyze (e.g., `/sites/digital`, `/`) |
| Weight by dropdown | Switch between "Size (bytes)" and "Number of nodes" |
| Compute button | Submit analysis (or Ctrl+Enter) |
| Flamegraph tab | Visualize hierarchy; click a frame to zoom, breadcrumb to zoom out |
| Tree table tab | Browse complete tree with statistics |
| Largest items tab | Sorted list of top-N nodes by metric |
| Comparison tab | Load a baseline snapshot and view differences |
| Download button (flamegraph tab) | Save current snapshot as JSON |
| Upload button | Load a previously saved snapshot |
| Compare with… button (comparison tab) | Load a baseline for diff view |

### Save & Load Snapshots

Use the **Download** button to save the current tree data as a JSON file (`jcr-stats-flamegraph-*.json`). Use **Upload** to load a saved snapshot back into the UI. The comparison view then lets you load a baseline and see side-by-side diffs highlighting growth, shrinkage, and newly added paths.

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

#### `jcrStats.reports(): [JcrStatsReport!]!`

Lists all generated flamegraph files stored in `/sites/systemsite/files/jcr-stats`.

**Returns `JcrStatsReport`:**
- `path: String!` — JCR path of the flamegraph file node
- `name: String!` — Node name
- `url: String!` — Browser URL to view the flamegraph

### Mutations

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

### Permission: `jcrStatsAdmin`

All JCR Stats operations require the `jcrStatsAdmin` permission. This is a fine-grained admin permission that does not grant full server administration rights.

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
- **ComputeResult** — Immutable result value (path, totalSize, nodeCount, flamegraphPath)
- **NodeStats** — Recursive node statistics (name, path, size, nodeCount, children)
- **ComputeSizeCommand** — Karaf shell command entry point

**GraphQL Package:** `org.jahia.community.jcrstats.graphql`

- **JcrStatsQueryExtension** — Extends DXM GraphQL root Query with `jcrStats` namespace
- **JcrStatsQuery** — Query operations (size, nodeCount, tree, reports)
- **JcrStatsMutationExtension** — Extends DXM GraphQL root Mutation with `jcrStats` namespace
- **JcrStatsMutation** — Mutation operations (computeSize)
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

**Current Version:** 2.1.0-SNAPSHOT

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
