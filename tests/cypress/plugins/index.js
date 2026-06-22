/// <reference types="cypress" />

/**
 * @type {Cypress.PluginConfig}
 */
module.exports = (on, config) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('cypress-terminal-report/src/installLogsPrinter')(on);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@jahia/cypress/dist/plugins/registerPlugins').registerPlugins(on, config);

    return config;
};
