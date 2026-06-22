import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TreeTable} from '../TreeTable';
import {TopList} from '../TopList';
import {DiffTable} from '../DiffTable';
import {JContentLink} from '../JContentLink';
import {METRIC_SIZE} from '../jcrStatsUtils';

// Lightweight i18n mock: t(key, opts) echoes the key and interpolates {{name}} so the
// rendered markup is deterministic without loading real translation resources.
// jest.mock is hoisted above the imports by babel-jest.
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, opts) => {
            if (opts && typeof opts.name === 'string') {
                return `${key}:${opts.name}`;
            }

            return key;
        }
    })
}));

const tree = {
    name: 'root',
    path: '/sites/demo',
    size: 4096,
    nodeCount: 3,
    children: [
        {name: 'child-a', path: '/sites/demo/child-a', size: 3072, nodeCount: 1, children: []},
        {name: 'child-b', path: '/sites/demo/child-b', size: 1024, nodeCount: 1, children: []}
    ]
};

describe('JContentLink', () => {
    it('renders an anchor with the jContent href and visible label for a /sites path', () => {
        const html = renderToStaticMarkup(<JContentLink path="/sites/demo/child-a"/>);
        expect(html).toContain('href="/jahia/jcontent/');
        expect(html).toContain('label.openJContent');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain('target="_blank"');
    });

    it('renders nothing for a non-linkable path', () => {
        const html = renderToStaticMarkup(<JContentLink path="/content/foo"/>);
        expect(html).toBe('');
    });
});

describe('TreeTable', () => {
    it('renders the table testid and the root + child node names', () => {
        const html = renderToStaticMarkup(<TreeTable tree={tree} metric={METRIC_SIZE}/>);
        expect(html).toContain('data-testid="jcrstats-table"');
        expect(html).toContain('root');
        expect(html).toContain('child-a');
    });

    it('renders an expand/collapse toggle with an accessible label for nodes with children', () => {
        const html = renderToStaticMarkup(<TreeTable tree={tree} metric={METRIC_SIZE}/>);
        expect(html).toContain('aria-expanded');
        // Toggle label echoes the i18n key with the node name interpolated
        expect(html).toMatch(/label\.(collapse|expand):root/);
    });

    it('renders a jContent link (visible text, consistent with TopList) for linkable rows', () => {
        const html = renderToStaticMarkup(<TreeTable tree={tree} metric={METRIC_SIZE}/>);
        expect(html).toContain('/jahia/jcontent/');
        expect(html).toContain('label.openJContent');
    });
});

describe('TopList', () => {
    it('renders the largest testid and includes a jContent anchor', () => {
        const html = renderToStaticMarkup(<TopList tree={tree} metric={METRIC_SIZE}/>);
        expect(html).toContain('data-testid="jcrstats-largest"');
        expect(html).toContain('href="/jahia/jcontent/');
    });

    it('lists the children sorted (largest first)', () => {
        const html = renderToStaticMarkup(<TopList tree={tree} metric={METRIC_SIZE}/>);
        // Child-a (3072) should appear before child-b (1024) in the markup
        expect(html.indexOf('child-a')).toBeLessThan(html.indexOf('child-b'));
    });
});

describe('DiffTable', () => {
    it('renders the diff testid and rows with changed paths', () => {
        const baseline = {
            name: 'root', path: '/sites/demo', size: 0, children: [
                {name: 'child-a', path: '/sites/demo/child-a', size: 1000, children: []}
            ]
        };
        const current = {
            name: 'root', path: '/sites/demo', size: 0, children: [
                {name: 'child-a', path: '/sites/demo/child-a', size: 3000, children: []}
            ]
        };
        const html = renderToStaticMarkup(<DiffTable baseline={baseline} current={current}/>);
        expect(html).toContain('data-testid="jcrstats-diff"');
        expect(html).toContain('child-a');
    });

    it('renders a "no changes" row when there is zero delta everywhere', () => {
        const same = {
            name: 'root', path: '/sites/demo', size: 0, children: [
                {name: 'child-a', path: '/sites/demo/child-a', size: 1000, children: []}
            ]
        };
        const html = renderToStaticMarkup(<DiffTable baseline={same} current={same}/>);
        expect(html).toContain('label.diffNone');
    });
});
