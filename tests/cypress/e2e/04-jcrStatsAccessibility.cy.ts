import { DocumentNode } from 'graphql'

/**
 * F30 — WCAG 2.2 accessibility of the JCR Stats admin UI.
 *
 * Existing 02 specs assert testids and layout; this spec asserts the ARIA contract the React source
 * ships (JcrStats.jsx): live-region roles (status/alert), the progressbar's value range, the
 * flamegraph's role=img + accessible name, accessible button names, focus not being relocated on
 * async completion, and graceful behaviour under prefers-reduced-motion.
 */
describe('JCR Stats - Accessibility (WCAG 2.2)', () => {
    const adminPath = '/jahia/administration/jcrStats'
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getStatus: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getStatus.graphql')

    before(() => {
        cy.login()
    })

    // The async computation is shared server state; wait until it is idle before each test so a
    // long-running job started by a previous test is not picked up by the next one.
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

    it('exposes a progressbar with a valid value range while computing', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites')
        cy.contains('button', 'Compute').click()

        // The progress block renders only while computing; its progressbar must expose the AAA value
        // range so assistive technology can report progress.
        cy.get('[data-testid="jcrstats-progress"]', { timeout: 30000 }).should('be.visible')
        cy.get('[role="progressbar"]')
            .should('exist')
            .and('have.attr', 'aria-valuemin', '0')
            .and('have.attr', 'aria-valuemax', '100')
        cy.get('[role="progressbar"]').should('have.attr', 'aria-valuetext')
        // The button icon spinner is decorative but carries an accessible name (role=img + aria-label).
        cy.get('[role="progressbar"]').should('have.attr', 'aria-label')
    })

    it('announces success with role="status" after a computation completes', () => {
        cy.login()
        cy.visit(adminPath)
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')
        // Non-urgent success is a polite live region (role=status), never role=alert.
        cy.get('[role="status"]').should('exist')
    })

    it('announces a load error with role="alert" (assertive) and shows no flamegraph', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('[data-testid="jcrstats-load-input"]').selectFile(
            { contents: Cypress.Buffer.from('not json'), fileName: 'bad.json' },
            { force: true },
        )
        cy.get('[role="alert"]').should('be.visible').and('not.be.empty')
        cy.get('[data-testid="jcrstats-flamegraph-react"]').should('not.exist')
    })

    it('wraps the mouse-only flamegraph in role="img" with an accessible name', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites/systemsite')
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')

        // The non-keyboard-operable flamegraph is exposed to AT as an image with a descriptive name.
        cy.get('[data-testid="jcrstats-flamegraph-react"]')
            .parents('[role="img"]')
            .should('exist')
            .and('have.attr', 'aria-label')
            .and('not.be.empty')
    })

    it('gives every saved-execution row button an accessible name', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('[data-testid="jcrstats-load-input"]').selectFile('cypress/fixtures/sample-flamegraph.json', {
            force: true,
        })
        cy.get('[data-testid="jcrstats-snapshots"]', { timeout: 30000 }).should('be.visible')
        // Compact visible labels are disambiguated by per-row aria-labels carrying the snapshot name.
        cy.get('[data-testid="jcrstats-snapshots"]').find('button').each(($button) => {
            const label = $button.attr('aria-label') || $button.text()
            expect(label.trim(), 'each snapshot-row button has an accessible name').to.not.equal('')
        })
    })

    it('does not relocate focus to the flamegraph when the async computation completes', () => {
        cy.login()
        cy.visit(adminPath)
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites/systemsite')
        cy.contains('button', 'Compute').click()
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')

        // Focus must stay where the user left it (button/body); an async result must not steal focus.
        cy.get('[data-testid="jcrstats-flamegraph-react"]').then(($flamegraph) => {
            cy.document().then((doc) => {
                expect($flamegraph[0].contains(doc.activeElement), 'focus not moved into the flamegraph').to.be
                    .false
            })
        })
    })

    it('still computes and renders under prefers-reduced-motion', () => {
        cy.login()
        // Emulate a reduced-motion preference for the whole page lifecycle.
        cy.visit(adminPath, {
            onBeforeLoad(win) {
                cy.stub(win, 'matchMedia')
                    .callThrough()
                    .withArgs('(prefers-reduced-motion: reduce)')
                    .returns({
                        matches: true,
                        media: '(prefers-reduced-motion: reduce)',
                        onchange: null,
                        addEventListener() {
                            /* no-op */
                        },
                        removeEventListener() {
                            /* no-op */
                        },
                        addListener() {
                            /* deprecated no-op */
                        },
                        removeListener() {
                            /* deprecated no-op */
                        },
                        dispatchEvent: () => false,
                    } as unknown as MediaQueryList)
            },
        })
        cy.get('#jcrstats-path').clear()
        cy.get('#jcrstats-path').type('/sites/systemsite')
        cy.contains('button', 'Compute').click()

        // With animation suppressed the progressbar is still exposed and the computation completes.
        cy.get('[data-testid="jcrstats-flamegraph-react"]', { timeout: 60000 }).should('be.visible')
    })
})
