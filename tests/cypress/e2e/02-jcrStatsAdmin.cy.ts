describe('JCR Stats - Admin UI', () => {
    const adminPath = '/jahia/administration/jcrStatsExecution';

    before(() => {
        cy.login();
    });

    it('shows the page title', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('h2', 'JCR Statistics').should('be.visible');
    });

    it('shows the path input with a default value', () => {
        cy.login();
        cy.visit(adminPath);
        cy.get('#jcrstats-path').should('be.visible').and('have.value', '/sites/systemsite');
    });

    it('shows the Compute size button', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').should('be.visible');
    });

    it('renders the interactive flamegraph directly in React (no HTML report)', () => {
        cy.login();
        cy.visit(adminPath);
        cy.get('#jcrstats-path').clear();
        cy.get('#jcrstats-path').type('/sites/systemsite');
        cy.contains('button', 'Compute size').click();

        // The react-flame-graph panel renders in-app from jcrStats.tree; its root frame is
        // labelled with the computed root node name.
        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000})
            .should('be.visible')
            .and('contain', 'systemsite');
        cy.get('[data-testid="jcrstats-flamegraph-caption"]').should('contain', 'systemsite');

        // The generated HTML report is no longer shown in the UI
        cy.get('[data-testid="jcrstats-flamegraph-frame"]').should('not.exist');
        cy.get('[data-testid="jcrstats-reports"]').should('not.exist');
    });

    it('sizes the flamegraph to the viewport: full-width and not past the window bottom', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000}).should('be.visible');

        cy.window().then(win => {
            cy.get('[data-testid="jcrstats-flamegraph-react"]').then($el => {
                const rect = $el[0].getBoundingClientRect();
                // Fills most of the viewport width...
                expect(rect.width, 'flamegraph width').to.be.greaterThan(win.innerWidth * 0.5);
                // ...and its bottom stays within the window (allow a few px for borders/rounding)
                expect(rect.bottom, 'flamegraph bottom vs window').to.be.at.most(win.innerHeight + 4);
            });
        });
    });
});
