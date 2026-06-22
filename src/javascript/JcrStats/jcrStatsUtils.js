export const KIB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export const METRIC_SIZE = 'size';
export const METRIC_NODES = 'nodes';

// Export-format envelope written by the Save action; accepted (but not required) on import.
export const SAVE_FORMAT = 'jcr-stats-flamegraph';

// Security (H-1) caps for imported snapshot files. Generous so the shipped fixtures and
// real exports (maxDepth 6, large repos) load fine, but bounded to reject hostile payloads.
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024; // 50 MB raw text
export const MAX_IMPORT_DEPTH = 64; // Far beyond the maxDepth-6 export
export const MAX_IMPORT_NODES = 2000000; // 2M nodes total

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

// Reject prototype-pollution vectors: any object literal whose OWN keys include a forbidden name.
const hasForbiddenKeys = obj => Object.keys(obj).some(k => FORBIDDEN_KEYS.includes(k));

// Recursively validate a parsed tree node. Throws Error on the first violation so the caller
// can surface a load error. Returns nothing; mutates a shared counter object for the node cap.
const validateNode = (node, depth, counter) => {
    if (depth > MAX_IMPORT_DEPTH) {
        throw new Error('tree exceeds maximum depth');
    }

    if (!node || typeof node !== 'object' || Array.isArray(node)) {
        throw new Error('invalid tree node');
    }

    if (hasForbiddenKeys(node)) {
        throw new Error('forbidden key in tree node');
    }

    counter.count += 1;
    if (counter.count > MAX_IMPORT_NODES) {
        throw new Error('tree exceeds maximum node count');
    }

    if (typeof node.name !== 'string') {
        throw new Error('node name must be a string');
    }

    const size = Number(node.size);
    if (!Number.isFinite(size) || size < 0) {
        throw new Error('node size must be a finite non-negative number');
    }

    const nodeCount = Number(node.nodeCount);
    if (!Number.isFinite(nodeCount) || nodeCount < 0) {
        throw new Error('node nodeCount must be a finite non-negative number');
    }

    if (node.children !== undefined) {
        if (!Array.isArray(node.children)) {
            throw new Error('node children must be an array');
        }

        node.children.forEach(child => validateNode(child, depth + 1, counter));
    }
};

// Validate + extract a tree from an imported file (export envelope or a raw tree node).
// Throws Error on any structural / security violation; returns {tree, path} on success.
export const extractTree = parsed => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a valid snapshot');
    }

    if (hasForbiddenKeys(parsed)) {
        throw new Error('forbidden key in snapshot');
    }

    // Back-compat: accept either an export envelope ({format, tree, path}) or a raw tree node.
    const isEnvelope = parsed.tree && typeof parsed.tree === 'object';
    if (isEnvelope && parsed.format !== undefined && parsed.format !== SAVE_FORMAT) {
        throw new Error('unrecognized snapshot format');
    }

    const loaded = isEnvelope ? parsed.tree : parsed;
    validateNode(loaded, 0, {count: 0});

    const envelopePath = isEnvelope && typeof parsed.path === 'string' ? parsed.path : null;
    return {tree: loaded, path: envelopePath || loaded.name};
};

// Map the jcrStats.tree shape onto react-flame-graph's {name, value, children}. The `value`
// (frame width) follows the chosen metric, floored at 1 so zero-weight subtrees still render.
// Raw measures + path are kept on the node (carried on react-flame-graph's `.source`).
export const toFlameNode = (node, metric) => {
    const bytes = Number.isFinite(Number(node.size)) ? Number(node.size) : 0;
    const nodeCount = Number.isFinite(Number(node.nodeCount)) ? Number(node.nodeCount) : 0;
    const weight = metric === METRIC_NODES ? nodeCount : bytes;
    return {
        name: typeof node.name === 'string' ? node.name : '(unknown)',
        value: Math.max(weight, 1),
        bytes,
        nodeCount,
        nodePath: node.path,
        tooltip: `${node.name}: ${formatBytes(bytes)} · ${nodeCount} nodes`,
        children: Array.isArray(node.children) ? node.children.map(child => toFlameNode(child, metric)) : []
    };
};

export const formatBytes = bytes => {
    const n = Number(bytes);
    if (bytes === null || bytes === undefined || !Number.isFinite(n) || n < 0) {
        return '—';
    }

    let value = n;
    let unitIndex = 0;
    while (value >= KIB && unitIndex < UNITS.length - 1) {
        value /= KIB;
        unitIndex += 1;
    }

    return `${unitIndex === 0 ? value : value.toFixed(1)} ${UNITS[unitIndex]}`;
};

// Numeric measure for a node given the active metric (aggregated bytes or node count).
export const measureOf = (node, metric) => {
    const v = metric === METRIC_NODES ? Number(node.nodeCount) : Number(node.size);
    return Number.isFinite(v) ? v : 0;
};

export const percent = (part, whole) => {
    if (!whole) {
        return 0;
    }

    const p = (part / whole) * 100;
    return Number.isFinite(p) ? p : 0;
};

// Flatten the tree (excluding the synthetic root) into a list with depth.
export const flatten = (node, acc = [], depth = 0) => {
    if (depth > 0) {
        acc.push({
            name: node.name,
            path: node.path,
            size: Number(node.size) || 0,
            nodeCount: Number(node.nodeCount) || 0,
            depth
        });
    }

    (node.children || []).forEach(child => flatten(child, acc, depth + 1));
    return acc;
};

// Best-effort jContent deep link for a JCR node path: opens the content browser of the owning
// site. Only nodes under /sites/<siteKey>/ are linkable; returns null otherwise.
export const buildJContentUrl = (path, language = 'en') => {
    if (typeof path !== 'string') {
        return null;
    }

    const match = path.match(/^\/sites\/([^/]+)(\/.*)?$/);
    if (!match) {
        return null;
    }

    const site = match[1];
    const segments = (match[2] || '')
        .split('/')
        .filter(Boolean)
        .filter(segment => segment !== '..');
    // The jContent section depends on where the node lives under the site:
    // files -> Media, contents -> Content folders, anything else (the page tree) -> Pages.
    const root = segments[0];
    const section = root === 'files' ? 'media' :
        root === 'contents' ? 'content-folders' :
            root ? 'pages' : 'content-folders';
    const rest = segments.map(encodeURIComponent).join('/');
    const base = `/jahia/jcontent/${encodeURIComponent(site)}/${language}/${section}`;
    return rest ? `${base}/${rest}` : base;
};

// Diff two trees by JCR path: rows {path, name, baseSize, curSize, delta} sorted by |delta| desc.
export const diffTrees = (baseline, current) => {
    const map = new Map();
    const walk = (node, key) => {
        if (!node) {
            return;
        }

        const p = node.path || node.name;
        if (!map.has(p)) {
            map.set(p, {path: p, name: node.name, baseSize: 0, curSize: 0});
        }

        map.get(p)[key] = Number(node.size) || 0;
        (node.children || []).forEach(child => walk(child, key));
    };

    walk(baseline, 'baseSize');
    walk(current, 'curSize');
    return Array.from(map.values())
        .map(r => ({...r, delta: r.curSize - r.baseSize}))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
};

export const signedBytes = delta => {
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
    return `${sign}${formatBytes(Math.abs(delta))}`;
};

// Human-readable elapsed time, e.g. "8s" or "2m 05s".
export const formatDuration = ms => {
    const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
};
