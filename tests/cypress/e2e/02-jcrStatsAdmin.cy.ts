import { DocumentNode } from 'graphql'

describe('JCR Stats - Admin UI', () => {
    const adminPath = '/jahia/administration/jcrStats'
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getStatus: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getStatus.graphql')

    before(() => {
        cy.login()
    })

    // The async computation is shared server state; wait until it is idle before each test so a
    // long-running job started by a previous test is not picked up by the next one (resume-on-mount).
    beforeEach(() => {
        cy.login()
        cy.waitUntil(
            () =>
                cy
                    .apollo({ query: getStatus, fetchPolicy: 'no-cache' })
                    .then(
                        (r: { data: { jcrStats: { status: { running: boolean } } } }) =>
                            r.data.jcrStats.status.running === false,
                    ),
            { timeout: 60000, interval: 2000 },
        )
    })

    it('shows the page title', () => {
        cy.login()
        cy.visit(adminPath)
        cy.contains('h2', 'JCR Statistics', { timeout: 30000 }).should('be.visible')
    })

    it('shows the path input with a default value', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-path', { timeout: 30000 }).should('be.visible').and('have.value', '/sites')
    })

    it('shows the metric selector defaulting to size', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-metric', { timeout: 30000 }).should('be.visible').and('have.value', 'size')
    })

    it('renders the interactive flamegraph directly in React (no HTML report)', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites/systemsite')
        cy.contains('button', 'Compute').click()

        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 })
            .should('be.visible')
            .and('contain', 'systemsite')
        cy.get('[data-testid="jcrstats-flamegraph-caption"]').should('contain', 'systemsite')

        // The generated HTML report is no longer shown in the UI
        cy.get('[data-testid="jcrstats-flamegraph-frame"]').should('not.exist')
        cy.get('[data-testid="jcrstats-reports"]').should('not.exist')
    })

    it('can weight the flamegraph by number of nodes', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-metric').select('nodes')
        cy.contains('button', 'Compute').click()

        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 })
            .should('be.visible')
            .and('contain', 'sites')
        // The caption reports the node-count measure when weighting by nodes
        cy.get('[data-testid="jcrstats-flamegraph-caption"]').should('contain', 'nodes')
    })

    it('submits the form with Ctrl+Enter', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites/systemsite')
        cy.get('#jcrstats-path').type('{ctrl}{enter}')
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 })
            .should('be.visible')
            .and('contain', 'systemsite')
    })

    it('sizes the flamegraph to the viewport: full-width and not past the window bottom', () => {
        cy.login()
        cy.visit(adminPath)
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')

        cy.window().then((win) => {
            cy.get('[data-testid="jcrstats-flamegraph-react"]').then(($el) => {
                const rect = $el[0].getBoundingClientRect()
                expect(rect.width, 'flamegraph width').to.be.greaterThan(win.innerWidth * 0.5)
                expect(rect.bottom, 'flamegraph bottom vs window').to.be.at.most(win.innerHeight + 4)
            })
        })
    })

    it('reacts to clicking a flamegraph frame (focus shows the measure)', () => {
        cy.login()
        cy.visit(adminPath)
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 })
            .should('be.visible')
            .and('contain', 'sites')

        // Frames are SVG <rect>s; the text <div> is pointer-events:none, so a real click lands
        // on the rect. Click by coordinate within the top row (rowHeight=20) to hit the root.
        cy.get('[data-testid="jcrstats-flamegraph-react"]').click(80, 10)
        // Caption shows "Focused: <name> — <measure>" with a numeric measure (size in default mode)
        cy.get('[data-testid="jcrstats-flamegraph-caption"]', { timeout: 10000 })
            .invoke('text')
            .should('match', /Focused:.*\d/)
    })
    it('loads a saved flamegraph from a file (no recompute)', () => {
        cy.login()
        cy.visit(adminPath)
        // Import a saved file directly — no Compute needed
        cy.get('[data-testid="jcrstats-load-input"]').selectFile('cypress/fixtures/sample-flamegraph.json', {
            force: true,
        })

        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 30000 })
            .should('be.visible')
            .and('contain', 'loaded-sample')
        cy.get('[data-testid="jcrstats-flamegraph-caption"]').should('contain', 'loaded-sample')
    })

    it('offers a Save data button once a flamegraph is shown', () => {
        cy.login()
        cy.visit(adminPath)
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')
        cy.contains('button', 'Save data').should('be.visible')
    })
    it('shows a tree-table with percentages', () => {
        cy.login()
        cy.visit(adminPath)
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')
        cy.get('#jcrstats-view').select('table')
        cy.get('[data-testid="jcrstats-table"]').should('be.visible').and('contain', '% total').and('contain', 'sites')
    })

    it('shows the largest items with jContent links', () => {
        cy.login()
        cy.visit(adminPath)
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')
        cy.get('#jcrstats-view').select('largest')
        cy.get('[data-testid="jcrstats-largest"]').should('be.visible')
        // Nodes under a site deep-link into jContent
        cy.get('[data-testid="jcrstats-largest"] a[href*="/jahia/jcontent/"]').should('exist')
    })

    it('shows an error banner and no flamegraph when a malformed file is loaded', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('[data-testid="jcrstats-load-input"]').selectFile(
            { contents: Cypress.Buffer.from('not json'), fileName: 'bad.json' },
            { force: true },
        )
        // The interactive flamegraph must NOT appear
        cy.get('[data-testid="jcrstats-flamegraph-react"]').should('not.exist')
        // An error alert must be visible and carry meaningful text
        cy.get('[role="alert"]').should('be.visible').and('not.be.empty')
    })

    // ------------------------------------------------------------------
    // Saved-executions panel: a loaded file is auto-saved as a snapshot, then
    // View reloads it, Compare diffs it against the current tree, Delete removes it.
    // ------------------------------------------------------------------
    it('lists a loaded snapshot in the Saved-executions panel with date + size metadata', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('[data-testid="jcrstats-load-input"]').selectFile('cypress/fixtures/sample-flamegraph.json', {
            force: true,
        })
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 30000 }).should('be.visible')
        // The auto-saved snapshot shows up in the saved-executions panel.
        cy.get('[data-testid="jcrstats-snapshots"]', { timeout: 30000 }).should('be.visible')
        // E-1: each row carries a "date · size" metadata line beside the filename.
        cy.get('[data-testid="jcrstats-snapshots"]').should('contain', '·')
    })

    it('reloads a saved snapshot as the current tree via View', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('[data-testid="jcrstats-load-input"]').selectFile('cypress/fixtures/sample-flamegraph.json', {
            force: true,
        })
        cy.get('[data-testid="jcrstats-snapshots"]', { timeout: 30000 }).should('be.visible')
        // Click the first row's View button and confirm the flamegraph renders the loaded tree.
        cy.get('[data-testid="jcrstats-snapshots"]').contains('button', 'View').first().click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 30000 })
            .should('be.visible')
            .and('contain', 'loaded-sample')
    })

    it('enables Compare once a current result exists and switches to the diff view (E-4)', () => {
        cy.login()
        cy.visit(adminPath)
        // Load a tree as the CURRENT result so Compare has something to diff a snapshot against.
        cy.get('[data-testid="jcrstats-load-input"]').selectFile('cypress/fixtures/sample-flamegraph-v2.json', {
            force: true,
        })
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 30000 }).should('be.visible')
        cy.get('[data-testid="jcrstats-snapshots"]', { timeout: 30000 }).should('be.visible')
        // With a current tree present, Compare is enabled — clicking it switches to the diff view.
        // (Diff content is data-dependent on shared server snapshots, so assert the view, not a row.)
        cy.get('[data-testid="jcrstats-snapshots"]')
            .contains('button', 'Compare')
            .first()
            .should('not.be.disabled')
            .click()
        cy.get('[data-testid="jcrstats-diff"]', { timeout: 10000 }).should('be.visible')
    })

    it('deletes a saved snapshot via the per-row Delete button', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('[data-testid="jcrstats-load-input"]').selectFile('cypress/fixtures/sample-flamegraph.json', {
            force: true,
        })
        cy.get('[data-testid="jcrstats-snapshots"]', { timeout: 30000 }).should('be.visible')
        cy.get('[data-testid="jcrstats-snapshots"] li')
            .its('length')
            .then((rowsBefore) => {
                // Delete uses an accessible inline two-step confirm (no native window.confirm):
                // the first click arms the row, then the inline "Confirm delete" button performs it.
                cy.get('[data-testid="jcrstats-snapshots"]').contains('button', 'Delete').first().click()
                cy.get('[data-testid="jcrstats-snapshot-confirm-delete"]', { timeout: 10000 }).first().click()
                // A success status banner confirms the deletion to sighted users (A-12).
                cy.get('[role="status"]', { timeout: 30000 }).should('contain', 'deleted')
                // The list re-renders only after the post-delete refetch resolves, so use a retrying
                // assertion (not a one-shot DOM read) to wait for the row count to actually shrink.
                cy.get('[data-testid="jcrstats-snapshots"] li', { timeout: 30000 }).should(
                    'have.length.lessThan',
                    rowsBefore,
                )
            })
    })

    // ------------------------------------------------------------------
    // Cancel a running computation: the Cancel button surfaces an info banner.
    // ------------------------------------------------------------------
    it('cancels a running computation and shows an info banner', () => {
        cy.login()
        cy.visit(adminPath)
        // Compute the whole /sites subtree so the job runs long enough to be cancelled.
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites')
        cy.contains('button', 'Compute').click()
        // Harden against racing a fast job: wait until the computation is visibly in progress
        // (the progress block renders only while computing === true) before clicking Cancel, rather
        // than assuming the job is still running by the time we act.
        cy.get('[data-testid="jcrstats-progress"]', { timeout: 30000 }).should('be.visible')
        cy.get('[data-testid="jcrstats-progress"]').contains('button', 'Cancel').click()
        // An info banner (role="status", not role="alert") reports the cancellation, and the
        // progress block disappears once watching stops.
        cy.get('[role="status"]', { timeout: 30000 }).should('contain', 'ancel')
        cy.get('[data-testid="jcrstats-progress"]').should('not.exist')
    })

    // ------------------------------------------------------------------
    // Exclusion add/remove round-trip via the flamegraph "Exclude this path" action.
    // ------------------------------------------------------------------
    it('adds then removes an exclusion (round-trip)', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites/systemsite')
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')
        // Focus a frame so the "Exclude this path" button appears, then exclude it.
        cy.get('[data-testid="jcrstats-flamegraph-react"]').click(80, 10)
        cy.contains('button', 'Exclude this path', { timeout: 10000 }).click()
        // The excluded path now appears in the Excluded-paths panel.
        cy.contains('Excluded paths', { timeout: 30000 }).should('be.visible')
        // Remove it again and confirm the success status is announced.
        cy.contains('button', 'Remove').first().click()
        cy.get('[role="status"]', { timeout: 30000 }).should('contain', 'Exclusion removed')
    })
})
