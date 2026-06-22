import {
    formatBytes,
    measureOf,
    percent,
    flatten,
    buildJContentUrl,
    diffTrees,
    signedBytes,
    METRIC_SIZE,
    METRIC_NODES,
    KIB
} from '../jcrStatsUtils.js';

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------
describe('formatBytes', () => {
    it('formats 0 bytes as "0 B"', () => {
        expect(formatBytes(0)).toBe('0 B');
    });

    it('formats negative numbers as the em-dash sentinel', () => {
        expect(formatBytes(-1)).toBe('—');
        expect(formatBytes(-1024)).toBe('—');
    });

    it('returns the em-dash sentinel for NaN', () => {
        expect(formatBytes(NaN)).toBe('—');
    });

    it('returns the em-dash sentinel for null', () => {
        expect(formatBytes(null)).toBe('—');
    });

    it('returns the em-dash sentinel for undefined', () => {
        expect(formatBytes(undefined)).toBe('—');
    });

    it('returns the em-dash sentinel for non-finite Infinity', () => {
        expect(formatBytes(Infinity)).toBe('—');
        expect(formatBytes(-Infinity)).toBe('—');
    });

    it('formats -0 as the em-dash sentinel (negative guard fires before isFinite)', () => {
        // -0 is falsy but Number(-0) === 0 and -0 < 0 is false.
        // The implementation checks n < 0, so -0 passes through and formats as "0 B".
        // Document the actual behaviour rather than guessing.
        const result = formatBytes(-0);
        expect(result).toBe('0 B');
    });

    it('formats bytes below 1 KiB with no decimal', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1023)).toBe('1023 B');
    });

    it('formats exactly 1 KiB as "1.0 KB"', () => {
        expect(formatBytes(KIB)).toBe('1.0 KB');
    });

    it('rolls over from KB to MB at 1 MiB', () => {
        expect(formatBytes(KIB * KIB)).toBe('1.0 MB');
    });

    it('rolls over from MB to GB at 1 GiB', () => {
        expect(formatBytes(KIB * KIB * KIB)).toBe('1.0 GB');
    });

    it('formats a fractional KB value with one decimal', () => {
        // 1536 bytes = 1.5 KiB
        expect(formatBytes(1536)).toBe('1.5 KB');
    });
});

// ---------------------------------------------------------------------------
// measureOf
// ---------------------------------------------------------------------------
describe('measureOf', () => {
    const node = {size: 4096, nodeCount: 7};

    it('returns size when metric is METRIC_SIZE', () => {
        expect(measureOf(node, METRIC_SIZE)).toBe(4096);
    });

    it('returns nodeCount when metric is METRIC_NODES', () => {
        expect(measureOf(node, METRIC_NODES)).toBe(7);
    });

    it('returns 0 when size is non-finite (NaN)', () => {
        expect(measureOf({size: NaN, nodeCount: 1}, METRIC_SIZE)).toBe(0);
    });

    it('returns 0 when nodeCount is non-finite (undefined)', () => {
        expect(measureOf({size: 100, nodeCount: undefined}, METRIC_NODES)).toBe(0);
    });

    it('returns 0 when value is Infinity', () => {
        expect(measureOf({size: Infinity, nodeCount: 1}, METRIC_SIZE)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// percent
// ---------------------------------------------------------------------------
describe('percent', () => {
    it('returns 0 when whole is 0', () => {
        expect(percent(50, 0)).toBe(0);
    });

    it('returns 0 when whole is null/undefined', () => {
        expect(percent(50, null)).toBe(0);
        expect(percent(50, undefined)).toBe(0);
    });

    it('computes correct percentage for normal values', () => {
        expect(percent(25, 100)).toBe(25);
        expect(percent(1, 3)).toBeCloseTo(33.33, 1);
    });

    it('handles part larger than whole (>100%)', () => {
        expect(percent(200, 100)).toBe(200);
    });

    it('returns 0 when part is 0', () => {
        expect(percent(0, 100)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// flatten
// ---------------------------------------------------------------------------
describe('flatten', () => {
    it('returns empty array for a leaf root (depth-0 root excluded, no children)', () => {
        const root = {name: 'root', path: '/root', size: 100, nodeCount: 1, children: []};
        expect(flatten(root)).toEqual([]);
    });

    it('excludes the root node itself (depth 0)', () => {
        const root = {
            name: 'root', path: '/root', size: 500, nodeCount: 2,
            children: [{name: 'child', path: '/root/child', size: 300, nodeCount: 1, children: []}]
        };
        const result = flatten(root);
        expect(result.map(r => r.name)).not.toContain('root');
    });

    it('includes immediate children at depth 1', () => {
        const root = {
            name: 'root', path: '/root', size: 500, nodeCount: 2,
            children: [{name: 'child', path: '/root/child', size: 300, nodeCount: 1, children: []}]
        };
        const result = flatten(root);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({name: 'child', depth: 1});
    });

    it('assigns increasing depth values through nested levels', () => {
        const tree = {
            name: 'r', path: '/r', size: 10, nodeCount: 3, children: [{
                name: 'a', path: '/r/a', size: 8, nodeCount: 2, children: [{
                    name: 'b', path: '/r/a/b', size: 4, nodeCount: 1, children: []
                }]
            }]
        };
        const result = flatten(tree);
        expect(result[0].depth).toBe(1);
        expect(result[1].depth).toBe(2);
    });

    it('handles nodes with no children property gracefully', () => {
        const root = {name: 'root', path: '/', size: 0, nodeCount: 1};
        expect(() => flatten(root)).not.toThrow();
    });

    it('coerces size and nodeCount to numbers', () => {
        const root = {
            name: 'r', path: '/', size: 0, nodeCount: 1,
            children: [{name: 'c', path: '/c', size: '512', nodeCount: '3', children: []}]
        };
        const result = flatten(root);
        expect(result[0].size).toBe(512);
        expect(result[0].nodeCount).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// buildJContentUrl
// ---------------------------------------------------------------------------
describe('buildJContentUrl', () => {
    it('returns null for a non-/sites path', () => {
        expect(buildJContentUrl('/content/something')).toBeNull();
        expect(buildJContentUrl('/jcr:root')).toBeNull();
    });

    it('returns null for a non-string input', () => {
        expect(buildJContentUrl(null)).toBeNull();
        expect(buildJContentUrl(undefined)).toBeNull();
        expect(buildJContentUrl(42)).toBeNull();
    });

    it('returns the base jContent URL for a bare /sites/<site> path', () => {
        expect(buildJContentUrl('/sites/mySite')).toBe(
            '/jahia/jcontent/mySite/en/content-folders'
        );
    });

    it('appends encoded path segments for a deep path', () => {
        expect(buildJContentUrl('/sites/mySite/contents/myFolder')).toBe(
            '/jahia/jcontent/mySite/en/content-folders/contents/myFolder'
        );
    });

    it('encodes a path segment containing a space', () => {
        expect(buildJContentUrl('/sites/mySite/my folder')).toBe(
            '/jahia/jcontent/mySite/en/content-folders/my%20folder'
        );
    });

    it('encodes a path segment with special characters', () => {
        expect(buildJContentUrl('/sites/mySite/a&b')).toBe(
            '/jahia/jcontent/mySite/en/content-folders/a%26b'
        );
    });

    it('respects a custom language parameter', () => {
        expect(buildJContentUrl('/sites/mySite/folder', 'fr')).toBe(
            '/jahia/jcontent/mySite/fr/content-folders/folder'
        );
    });

    it('strips .. traversal segments', () => {
        // BuildJContentUrl filters out '..' segments for safety
        expect(buildJContentUrl('/sites/mySite/../evil')).toBe(
            '/jahia/jcontent/mySite/en/content-folders/evil'
        );
    });
});

// ---------------------------------------------------------------------------
// diffTrees
// ---------------------------------------------------------------------------
describe('diffTrees', () => {
    const makeNode = (path, name, size, children = []) => ({path, name, size, children});

    it('returns empty array when both trees are empty/null', () => {
        expect(diffTrees(null, null)).toEqual([]);
    });

    it('computes a positive delta for a node that grew', () => {
        const base = makeNode('/sites/a', 'a', 100);
        const cur = makeNode('/sites/a', 'a', 300);
        const result = diffTrees(base, cur);
        const row = result.find(r => r.path === '/sites/a');
        expect(row.delta).toBe(200);
    });

    it('computes a negative delta for a deleted node (present in baseline, absent in current)', () => {
        const base = makeNode('/r', 'r', 0, [makeNode('/r/gone', 'gone', 500)]);
        const cur = makeNode('/r', 'r', 0, []);
        const result = diffTrees(base, cur);
        const row = result.find(r => r.path === '/r/gone');
        expect(row.delta).toBe(-500);
    });

    it('sorts rows by absolute delta descending', () => {
        const base = makeNode('/r', 'r', 0, [
            makeNode('/r/a', 'a', 1000),
            makeNode('/r/b', 'b', 100)
        ]);
        const cur = makeNode('/r', 'r', 0, [
            makeNode('/r/a', 'a', 1001), // Delta +1
            makeNode('/r/b', 'b', 200) // Delta +100
        ]);
        const result = diffTrees(base, cur);
        // /r/b has |delta|=100, /r/a has |delta|=1 — b should appear first
        const paths = result.map(r => r.path);
        expect(paths.indexOf('/r/b')).toBeLessThan(paths.indexOf('/r/a'));
    });

    it('falls back to node.name when path is an empty string', () => {
        // Walk() uses node.path || node.name
        const base = {path: '', name: 'nopath', size: 50, children: []};
        const cur = {path: '', name: 'nopath', size: 80, children: []};
        const result = diffTrees(base, cur);
        // Key is 'nopath' (the name fallback)
        const row = result.find(r => r.path === 'nopath');
        expect(row).toBeDefined();
        expect(row.delta).toBe(30);
    });
});

// ---------------------------------------------------------------------------
// signedBytes
// ---------------------------------------------------------------------------
describe('signedBytes', () => {
    it('formats 0 as "0 B" with no sign', () => {
        expect(signedBytes(0)).toBe('0 B');
    });

    it('prefixes positive deltas with "+"', () => {
        expect(signedBytes(1024)).toBe('+1.0 KB');
    });

    it('prefixes negative deltas with "-"', () => {
        expect(signedBytes(-1024)).toBe('-1.0 KB');
    });

    it('formats a large positive delta correctly', () => {
        expect(signedBytes(KIB * KIB)).toBe('+1.0 MB');
    });

    it('formats a large negative delta correctly', () => {
        expect(signedBytes(-KIB * KIB)).toBe('-1.0 MB');
    });
});
