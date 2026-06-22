export const KIB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export const METRIC_SIZE = 'size';
export const METRIC_NODES = 'nodes';

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
    const rest = (match[2] || '')
        .split('/')
        .filter(Boolean)
        .filter(segment => segment !== '..')
        .map(encodeURIComponent)
        .join('/');
    const base = `/jahia/jcontent/${site}/${language}/content-folders`;
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
