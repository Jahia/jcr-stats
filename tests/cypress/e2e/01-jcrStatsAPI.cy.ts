import {DocumentNode} from 'graphql';

describe('JCR Stats - GraphQL API', () => {
    const TEST_PATH = '/sites/systemsite';
    const FLAMEGRAPH_PATTERN = /^\/sites\/systemsite\/files\/jcr-stats\/.+\/flamegraph$/;
    const FLAMEGRAPH_URL_PATTERN = /^\/files\/default\/sites\/systemsite\/files\/jcr-stats\/.+\/flamegraph$/;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getSize: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getSize.graphql');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getTree: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getTree.graphql');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getReports: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getReports.graphql');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const computeSize: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/mutation/computeSize.graphql');

    before(() => {
        cy.login();
    });

    describe('jcrStats.size / nodeCount', () => {
        it('returns a non-negative size for an existing subtree', () => {
            cy.apollo({query: getSize, variables: {path: TEST_PATH}})
                .its('data.jcrStats.size')
                .should((size: number) => {
                    expect(Number(size)).to.be.at.least(0);
                });
        });

        it('returns a node count of at least 1 for an existing subtree', () => {
            cy.apollo({query: getSize, variables: {path: TEST_PATH}})
                .its('data.jcrStats.nodeCount')
                .should((count: number) => {
                    expect(Number(count)).to.be.at.least(1);
                });
        });

        it('returns -1 for a non-existing path', () => {
            cy.apollo({query: getSize, variables: {path: '/this/does/not/exist'}})
                .its('data.jcrStats.size')
                .should((size: number) => {
                    expect(Number(size)).to.eq(-1);
                });
        });
    });

    describe('jcrStats.tree', () => {
        it('returns a size-weighted recursive tree for flamegraph rendering', () => {
            cy.apollo({query: getTree, variables: {path: TEST_PATH, maxDepth: 3}})
                .its('data.jcrStats.tree')
                .should((tree: {name: string; size: number; nodeCount: number; children: unknown[]}) => {
                    expect(tree.name).to.eq('systemsite');
                    expect(Number(tree.size)).to.be.at.least(0);
                    expect(Number(tree.nodeCount)).to.be.at.least(1);
                    expect(tree.children).to.be.an('array');
                });
        });

        it('prunes children beyond maxDepth (maxDepth 0 = root only)', () => {
            cy.apollo({query: getTree, variables: {path: TEST_PATH, maxDepth: 0}})
                .its('data.jcrStats.tree.children')
                .should((children: unknown[]) => {
                    expect(children).to.be.an('array').that.has.length(0);
                });
        });
    });

    describe('jcrStats.computeSize', () => {
        // The returned flamegraphUrl is the Jahia file-servlet URL; that it actually serves a
        // renderable flamegraph is proven end-to-end (in an authenticated browser session) by
        // the admin UI spec — the file servlet only serves default-workspace files to a full session.
        it('computes the subtree, returns aggregated stats and a flamegraph path + url', () => {
            cy.apollo({mutation: computeSize, variables: {path: TEST_PATH, deleteTemporaryFile: false}})
                .its('data.jcrStats.computeSize')
                .should((result: Record<string, string | number>) => {
                    expect(result.path).to.eq(TEST_PATH);
                    expect(Number(result.totalSize)).to.be.at.least(0);
                    expect(Number(result.nodeCount)).to.be.at.least(1);
                    expect(result.flamegraphPath).to.match(FLAMEGRAPH_PATTERN);
                    expect(result.flamegraphUrl).to.match(FLAMEGRAPH_URL_PATTERN);
                });
        });
    });

    describe('jcrStats.reports', () => {
        it('lists the generated flamegraph with a renderable url after a computation', () => {
            cy.apollo({mutation: computeSize, variables: {path: TEST_PATH, deleteTemporaryFile: false}});
            cy.apollo({query: getReports})
                .its('data.jcrStats.reports')
                .should((reports: Array<{path: string; name: string; url: string}>) => {
                    expect(reports).to.be.an('array');
                    expect(reports.length).to.be.greaterThan(0);
                    expect(reports.map(r => r.name)).to.include('flamegraph');
                    reports.forEach(r => {
                        expect(r.path).to.contain('/sites/systemsite/files/jcr-stats');
                        expect(r.url).to.match(FLAMEGRAPH_URL_PATTERN);
                    });
                });
        });
    });

    describe('jcrStats async compute', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const compute: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/mutation/compute.graphql');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const getStatus: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getStatus.graphql');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const getResult: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getResult.graphql');

        it('computes asynchronously: compute starts a job, status reports completion, result returns the tree', () => {
            cy.apollo({mutation: compute, variables: {path: TEST_PATH}})
                .its('data.jcrStats.compute')
                .should('be.a', 'boolean');

            // Poll status until the background job finishes and a result is cached
            cy.waitUntil(
                () => cy.apollo({query: getStatus, fetchPolicy: 'no-cache'})
                    .then((r: {data: {jcrStats: {status: {running: boolean; hasResult: boolean}}}}) =>
                        r.data.jcrStats.status.running === false && r.data.jcrStats.status.hasResult === true),
                {timeout: 60000, interval: 2000}
            );

            cy.apollo({query: getResult, variables: {maxDepth: 3}})
                .its('data.jcrStats.result')
                .should((tree: {name: string; nodeCount: number}) => {
                    expect(Number(tree.nodeCount)).to.be.at.least(1);
                });
        });
    });
});
