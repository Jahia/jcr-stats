describe('JCR Stats - Admin UI', () => {
    const adminPath = '/jahia/administration/jcrStatsExecution';
    const FLAMEGRAPH_PATTERN = /^\/sites\/systemsite\/files\/jcr-stats\/.+\/flamegraph$/;

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
        cy.get('[data-testid="jcrstats-result-flamegraph"]')
            .invoke('text')
            .should('match', FLAMEGRAPH_PATTERN);
    });

    it('lists generated reports after a computation', () => {
        cy.login();
        cy.visit(adminPath);
        cy.contains('button', 'Compute size').click();
        cy.get('[data-testid="jcrstats-result"]', {timeout: 60000}).should('be.visible');
        cy.get('[data-testid="jcrstats-reports"] li').should('have.length.greaterThan', 0);
    });
});
