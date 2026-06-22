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
        cy.get('#jcrstats-path').should('be.visible').and('have.value', '/sites');
    });

    it('shows the metric selector defaulting to size', () => {
        cy.login();
        cy.visit(adminPath);
        cy.get('#jcrstats-metric').should('be.visible').and('have.value', 'size');
    });

    it('renders the interactive flamegraph directly in React (no HTML report)', () => {
        cy.login();
        cy.visit(adminPath);
        cy.get('#jcrstats-path').clear();
        cy.get('#jcrstats-path').type('/sites/systemsite');
        cy.contains('button', 'Compute size').click();

        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000})
            .should('be.visible')
            .and('contain', 'systemsite');
        cy.get('[data-testid="jcrstats-flamegraph-caption"]').should('contain', 'systemsite');

        // The generated HTML report is no longer shown in the UI
        cy.get('[data-testid="jcrstats-flamegraph-frame"]').should('not.exist');
        cy.get('[data-testid="jcrstats-reports"]').should('not.exist');
    });

    it('can weight the flamegraph by number of nodes', () => {
        cy.login();
        cy.visit(adminPath);
        cy.get('#jcrstats-metric').select('nodes');
        cy.contains('button', 'Compute size').click();

        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000})
            .should('be.visible')
            .and('contain', 'sites');
        // The caption reports the node-count measure when weighting by nodes
        cy.get('[data-testid="jcrstats-flamegraph-caption"]').should('contain', 'nodes');
    });

    it('submits the form with Ctrl+Enter', () => {
        cy.login();
        cy.visit(adminPath);
        cy.get('#jcrstats-path').clear();
        cy.get('#jcrstats-path').type('/sites/systemsite');
        cy.get('#jcrstats-path').type('{ctrl}{enter}');
        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000})
            .should('be.visible')
            .and('contain', 'systemsite');
    });

    it('sizes the flamegraph to the viewport: full-width and not past the window bottom', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000}).should('be.visible');

        cy.window().then(win => {
            cy.get('[data-testid="jcrstats-flamegraph-react"]').then($el => {
                const rect = $el[0].getBoundingClientRect();
                expect(rect.width, 'flamegraph width').to.be.greaterThan(win.innerWidth * 0.5);
                expect(rect.bottom, 'flamegraph bottom vs window').to.be.at.most(win.innerHeight + 4);
            });
        });
    });

    it('reacts to clicking a flamegraph frame (focus shows the measure)', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000})
            .should('be.visible')
            .and('contain', 'sites');

        // Frames are SVG <rect>s; the text <div> is pointer-events:none, so a real click lands
        // on the rect. Click by coordinate within the top row (rowHeight=20) to hit the root.
        cy.get('[data-testid="jcrstats-flamegraph-react"]').click(80, 10);
        // Caption shows "Focused: <name> — <measure>" with a numeric measure (size in default mode)
        cy.get('[data-testid="jcrstats-flamegraph-caption"]', {timeout: 10000})
            .invoke('text')
            .should('match', /Focused:.*\d/);
    });
    it('loads a saved flamegraph from a file (no recompute)', () => {
        cy.login();
        cy.visit(adminPath);
        // Import a saved file directly — no Compute needed
        cy.get('[data-testid="jcrstats-load-input"]').selectFile('cypress/fixtures/sample-flamegraph.json', {force: true});

        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 30000})
            .should('be.visible')
            .and('contain', 'loaded-sample');
        cy.get('[data-testid="jcrstats-flamegraph-caption"]').should('contain', 'loaded-sample');
    });

    it('offers a Save data button once a flamegraph is shown', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-flamegraph-react"]', {timeout: 60000}).should('be.visible');
        cy.contains('button', 'Save data').should('be.visible');
    });
});
