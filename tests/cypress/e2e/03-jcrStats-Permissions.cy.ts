import { DocumentNode } from 'graphql'
import { createUser, deleteUser, grantRoles } from '@jahia/cypress'

/**
 * Regression tests for the fine-grained `jcrStatsAdmin` permission across the stack:
 *  - Backend: every jcrStats GraphQL field is annotated `@GraphQLRequiresPermission("jcrStatsAdmin")`.
 *  - Frontend: `requiredPermission: 'jcrStatsAdmin'` in register.jsx gates the admin route.
 *  - RBAC content: the module ships the assignable `jcr-stats-administrator` role
 *    (src/main/import/roles.xml) granting only `administrationAccess` + `jcrStatsAdmin`.
 *
 * The "allowed" user is granted that role and nothing else — never `admin` — so the tests prove
 * fine-grained granularity, not merely that a full administrator can pass.
 */
describe('JCR Stats — permission enforcement', () => {
    const ROLE_NAME = 'jcr-stats-administrator'
    const DENIED_USER = 'jsDeniedUser'
    const ALLOWED_USER = 'jsAllowedUser'
    const PASSWORD = 'JsPerm9PwdTest'
    const ADMIN_PATH = '/jahia/administration/jcrStats'
    const TEST_PATH = '/sites/systemsite'

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const getSize: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/query/getSize.graphql')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const computeSize: DocumentNode = require('graphql-tag/loader!../fixtures/graphql/mutation/computeSize.graphql')

    const errorsOf = (result: { graphQLErrors?: Array<{ message: string }>; errors?: Array<{ message: string }> }) =>
        result.graphQLErrors ?? result.errors ?? []

    const querySizeAs = (username: string) => {
        cy.apolloClient({ username, password: PASSWORD })
        return cy.apollo({ query: getSize, variables: { path: TEST_PATH } })
    }

    const mutateComputeSizeAs = (username: string) => {
        cy.apolloClient({ username, password: PASSWORD })
        return cy.apollo({ mutation: computeSize, variables: { path: TEST_PATH, deleteTemporaryFile: true } })
    }

    before(() => {
        cy.login()
        createUser(DENIED_USER, PASSWORD)
        createUser(ALLOWED_USER, PASSWORD)
        // The annotation resolves the permission on the JCR root node, so grant the
        // module-shipped single-permission role on `/`.
        grantRoles('/', [ROLE_NAME], ALLOWED_USER, 'USER')
    })

    after(() => {
        cy.apolloClient() // reset the current Apollo client back to root
        cy.login()
        deleteUser(DENIED_USER)
        deleteUser(ALLOWED_USER)
    })

    describe('GraphQL API authorization', () => {
        it('denies the gated query for a user without the permission', () => {
            querySizeAs(DENIED_USER).then((result: never) => {
                const errs = errorsOf(result)
                expect(errs, 'denial errors').to.have.length.greaterThan(0)
                expect(errs.map((e: { message: string }) => e.message).join(' ')).to.contain('Permission denied')
            })
        })

        it('allows the gated query for a user granted only the module permission', () => {
            querySizeAs(ALLOWED_USER).then((result: never) => {
                expect(errorsOf(result), 'should have no errors').to.have.length(0)
                expect(Number((result as { data: { jcrStats: { size: number } } }).data.jcrStats.size)).to.be.at.least(
                    0,
                )
            })
        })

        it('denies the computeSize mutation for a user without the permission', () => {
            mutateComputeSizeAs(DENIED_USER).then((result: never) => {
                const errs = errorsOf(result)
                expect(errs, 'mutation denial errors').to.have.length.greaterThan(0)
                expect(errs.map((e: { message: string }) => e.message).join(' ')).to.contain('Permission denied')
            })
        })

        it('allows the computeSize mutation for a user granted only the module permission', () => {
            mutateComputeSizeAs(ALLOWED_USER).then((result: never) => {
                expect(errorsOf(result), 'should have no errors').to.have.length(0)
            })
        })
    })

    describe('Admin UI authorization', () => {
        it('hides the admin panel from a user without the permission', () => {
            cy.login(DENIED_USER, PASSWORD)
            cy.visit(ADMIN_PATH, { failOnStatusCode: false })
            cy.contains('h2', 'JCR Statistics').should('not.exist')
        })

        it('shows the admin panel to a user granted only the module permission', () => {
            cy.login(ALLOWED_USER, PASSWORD)
            cy.visit(ADMIN_PATH)
            cy.contains('h2', 'JCR Statistics', { timeout: 30000 }).should('be.visible')
        })
    })
})
