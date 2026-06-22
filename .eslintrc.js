module.exports = {
    extends: ['@jahia/eslint-config'],
    parserOptions: {
        requireConfigFile: false,
        babelOptions: {
            presets: ['@babel/preset-react']
        }
    },
    rules: {
        'react/prop-types': 'off'
    }
};
