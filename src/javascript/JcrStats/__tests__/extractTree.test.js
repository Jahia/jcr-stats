import {
    extractTree,
    toFlameNode,
    SAVE_FORMAT,
    MAX_IMPORT_DEPTH,
    MAX_IMPORT_NODES,
    METRIC_SIZE,
    METRIC_NODES
} from '../jcrStatsUtils.js';

// ---------------------------------------------------------------------------
// extractTree — validation + extraction of imported snapshots (security H-1)
// ---------------------------------------------------------------------------
describe('extractTree', () => {
    const validTree = () => ({
        name: 'root',
        path: '/sites/x',
        size: 100,
        nodeCount: 2,
        children: [
            {name: 'a', path: '/sites/x/a', size: 60, nodeCount: 1, children: []}
        ]
    });

    it('extracts a raw tree node (no envelope) using the node name as path fallback', () => {
        const raw = {name: 'rawroot', size: 10, nodeCount: 1};
        const result = extractTree(raw);
        expect(result.tree).toBe(raw);
        expect(result.path).toBe('rawroot');
    });

    it('extracts the tree from an export envelope and uses the envelope path', () => {
        const envelope = {format: SAVE_FORMAT, version: 1, path: '/loaded/sample', tree: validTree()};
        const result = extractTree(envelope);
        expect(result.tree.name).toBe('root');
        expect(result.path).toBe('/loaded/sample');
    });

    it('accepts an envelope with no format field (back-compat raw tree wrapper)', () => {
        const envelope = {path: '/p', tree: validTree()};
        expect(() => extractTree(envelope)).not.toThrow();
    });

    it('rejects an envelope whose format does not match SAVE_FORMAT', () => {
        const envelope = {format: 'something-else', tree: validTree()};
        expect(() => extractTree(envelope)).toThrow(/format/);
    });

    it('throws for null / non-object input', () => {
        expect(() => extractTree(null)).toThrow();
        expect(() => extractTree(undefined)).toThrow();
        expect(() => extractTree('a string')).toThrow();
        expect(() => extractTree(42)).toThrow();
    });

    it('throws for an array at the top level', () => {
        expect(() => extractTree([])).toThrow();
    });

    it('throws when name is not a string', () => {
        expect(() => extractTree({name: 123, size: 1, nodeCount: 1})).toThrow(/name/);
    });

    it('throws when size is missing / not a finite non-negative number', () => {
        expect(() => extractTree({name: 'n', nodeCount: 1})).toThrow(/size/);
        expect(() => extractTree({name: 'n', size: -1, nodeCount: 1})).toThrow(/size/);
        expect(() => extractTree({name: 'n', size: 'NaN-ish', nodeCount: 1})).toThrow(/size/);
        expect(() => extractTree({name: 'n', size: Infinity, nodeCount: 1})).toThrow(/size/);
    });

    it('throws when nodeCount is not a finite non-negative number', () => {
        expect(() => extractTree({name: 'n', size: 1, nodeCount: -5})).toThrow(/nodeCount/);
        expect(() => extractTree({name: 'n', size: 1, nodeCount: 'x'})).toThrow(/nodeCount/);
    });

    it('throws when children is present but not an array', () => {
        expect(() => extractTree({name: 'n', size: 1, nodeCount: 1, children: {}})).toThrow(/children/);
    });

    it('accepts a node with no children property', () => {
        expect(() => extractTree({name: 'n', size: 1, nodeCount: 1})).not.toThrow();
    });

    it('rejects a snapshot whose own keys include __proto__ (prototype pollution)', () => {
        // Build via JSON.parse so __proto__ is an OWN enumerable key, not the prototype.
        const malicious = JSON.parse('{"name":"n","size":1,"nodeCount":1,"__proto__":{"polluted":true}}');
        expect(() => extractTree(malicious)).toThrow(/forbidden/);
    });

    it('rejects a child node carrying a forbidden constructor key', () => {
        const malicious = JSON.parse(
            '{"name":"r","size":1,"nodeCount":1,"children":[{"name":"c","size":1,"nodeCount":1,"constructor":{}}]}'
        );
        expect(() => extractTree(malicious)).toThrow(/forbidden/);
    });

    it('rejects a tree deeper than MAX_IMPORT_DEPTH', () => {
        // Build a chain deeper than the cap.
        let node = {name: 'leaf', size: 1, nodeCount: 1, children: []};
        for (let i = 0; i < MAX_IMPORT_DEPTH + 2; i++) {
            node = {name: `n${i}`, size: 1, nodeCount: 1, children: [node]};
        }

        expect(() => extractTree(node)).toThrow(/depth/);
    });

    it('exposes a generous node cap (sanity check on the constant)', () => {
        expect(MAX_IMPORT_NODES).toBeGreaterThan(1000000);
    });

    it('accepts the shipped sample-flamegraph fixture shape', () => {
        const fixture = {
            format: SAVE_FORMAT,
            version: 1,
            path: '/loaded/sample',
            maxDepth: 6,
            tree: {
                name: 'loaded-sample',
                path: '/loaded/sample',
                size: 4096,
                nodeCount: 3,
                children: [
                    {name: 'child-a', path: '/loaded/sample/child-a', size: 3072, nodeCount: 1, children: []},
                    {name: 'child-b', path: '/loaded/sample/child-b', size: 1024, nodeCount: 1, children: []}
                ]
            }
        };
        const result = extractTree(fixture);
        expect(result.path).toBe('/loaded/sample');
        expect(result.tree.children).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// toFlameNode — map tree -> react-flame-graph node shape
// ---------------------------------------------------------------------------
describe('toFlameNode', () => {
    it('uses size as the value when metric is METRIC_SIZE', () => {
        const node = {name: 'n', size: 500, nodeCount: 3};
        expect(toFlameNode(node, METRIC_SIZE).value).toBe(500);
    });

    it('uses nodeCount as the value when metric is METRIC_NODES', () => {
        const node = {name: 'n', size: 500, nodeCount: 3};
        expect(toFlameNode(node, METRIC_NODES).value).toBe(3);
    });

    it('floors the value at 1 for a zero-weight node so it still renders', () => {
        const node = {name: 'n', size: 0, nodeCount: 0};
        expect(toFlameNode(node, METRIC_SIZE).value).toBe(1);
    });

    it('guards NaN size / nodeCount to 0 (value floored to 1)', () => {
        const node = {name: 'n', size: NaN, nodeCount: NaN};
        const out = toFlameNode(node, METRIC_SIZE);
        expect(out.bytes).toBe(0);
        expect(out.nodeCount).toBe(0);
        expect(out.value).toBe(1);
    });

    it('falls back to "(unknown)" when name is not a string', () => {
        expect(toFlameNode({name: 42, size: 1, nodeCount: 1}, METRIC_SIZE).name).toBe('(unknown)');
    });

    it('treats a non-array children property as no children', () => {
        const out = toFlameNode({name: 'n', size: 1, nodeCount: 1, children: 'nope'}, METRIC_SIZE);
        expect(out.children).toEqual([]);
    });

    it('recursively maps children', () => {
        const node = {
            name: 'r', size: 10, nodeCount: 2,
            children: [{name: 'c', size: 5, nodeCount: 1, children: []}]
        };
        const out = toFlameNode(node, METRIC_SIZE);
        expect(out.children).toHaveLength(1);
        expect(out.children[0].name).toBe('c');
    });

    it('preserves nodePath and builds a tooltip', () => {
        const out = toFlameNode({name: 'n', path: '/p', size: 2048, nodeCount: 4}, METRIC_SIZE);
        expect(out.nodePath).toBe('/p');
        expect(out.tooltip).toContain('n');
        expect(out.tooltip).toContain('nodes');
    });
});
