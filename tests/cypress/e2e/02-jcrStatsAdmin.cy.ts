describe('JCR Stats - Admin UI', () => {
    const adminPath = '/jahia/administration/jcrStatsExecution';
    const FLAMEGRAPH_URL_PATTERN = /^\/files\/default\/sites\/systemsite\/files\/jcr-stats\/.+\/flamegraph$/;

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

    it('computes the size and displays the result', () => {
        cy.login();
        cy.visit(adminPath);
        cy.get('#jcrstats-path').clear();
        cy.get('#jcrstats-path').type('/sites/systemsite');
        cy.contains('button', 'Compute size').click();

        cy.get('[data-testid="jcrstats-result"]', {timeout: 60000}).should('be.visible');
        cy.get('[data-testid="jcrstats-result-path"]').should('have.text', '/sites/systemsite');
        cy.get('[data-testid="jcrstats-result-count"]').should((el: JQuery<HTMLElement>) => {
            expect(Number(el.text())).to.be.at.least(1);
        });
    });

    it('renders the interactive flamegraph directly in React', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-result"]', {timeout: 60000}).should('be.visible');

        // The react-flame-graph panel renders in-app (no iframe) from the jcrStats.tree data;
        // its root frame is labelled with the computed root node name.
        cy.get('[data-testid="jcrstats-flamegraph-react"]')
            .should('be.visible')
            .and('contain', 'systemsite');
    });

    it('also exposes the server-generated HTML report in an iframe', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-result"]', {timeout: 60000}).should('be.visible');

        cy.get('[data-testid="jcrstats-flamegraph-frame"]')
            .should('be.visible')
            .and('have.attr', 'src')
            .and('match', FLAMEGRAPH_URL_PATTERN);
        cy.get('[data-testid="jcrstats-flamegraph-link"]')
            .should('have.attr', 'href')
            .and('match', FLAMEGRAPH_URL_PATTERN);

        // The iframe source actually serves the renderable flamegraph HTML
        cy.get('[data-testid="jcrstats-flamegraph-frame"]')
            .invoke('attr', 'src')
            .then((src: string) => {
                cy.request(src).then((resp: Cypress.Response<string>) => {
                    expect(resp.status).to.eq(200);
                    expect(resp.body).to.contain('JCR statistics');
                });
            });
    });

    it('lists generated reports as clickable links after a computation', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-result"]', {timeout: 60000}).should('be.visible');
        cy.get('[data-testid="jcrstats-reports"] li a')
            .should('have.length.greaterThan', 0)
            .first()
            .should('have.attr', 'href')
            .and('match', FLAMEGRAPH_URL_PATTERN);
    });
});
