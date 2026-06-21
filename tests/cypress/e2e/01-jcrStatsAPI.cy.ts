import {DocumentNode} from 'graphql';

describe('JCR Stats - GraphQL API', () => {
    const TEST_PATH = '/sites/systemsite';
    const FLAMEGRAPH_PATTERN = /^\/sites\/systemsite\/files\/jcr-stats\/.+\/flamegraph$/;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getSize: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getSize.graphql');
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

    describe('jcrStats.computeSize', () => {
        it('computes the subtree, returns aggregated stats and writes a flamegraph', () => {
            cy.apollo({mutation: computeSize, variables: {path: TEST_PATH, deleteTemporaryFile: false}})
                .its('data.jcrStats.computeSize')
                .should((result: Record<string, string | number>) => {
                    expect(result.path).to.eq(TEST_PATH);
                    expect(Number(result.totalSize)).to.be.at.least(0);
                    expect(Number(result.nodeCount)).to.be.at.least(1);
                    expect(result.flamegraphPath).to.match(FLAMEGRAPH_PATTERN);
                });
        });
    });

    describe('jcrStats.reports', () => {
        it('lists the generated flamegraph after a computation', () => {
            cy.apollo({mutation: computeSize, variables: {path: TEST_PATH, deleteTemporaryFile: false}});
            cy.apollo({query: getReports})
                .its('data.jcrStats.reports')
                .should((reports: Array<{path: string; name: string}>) => {
                    expect(reports).to.be.an('array');
                    expect(reports.length).to.be.greaterThan(0);
                    expect(reports.map(r => r.name)).to.include('flamegraph');
                    reports.forEach(r => expect(r.path).to.contain('/sites/systemsite/files/jcr-stats'));
                });
        });
    });
});
