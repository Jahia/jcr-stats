const path = require('path');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const moonstone = require('@jahia/moonstone/dist/rulesconfig-wp');
const {CycloneDxWebpackPlugin} = require('@cyclonedx/webpack-plugin');
const getModuleFederationConfig = require('@jahia/webpack-config/getModuleFederationConfig');
const packageJson = require('./package.json');

const cycloneDxWebpackPluginOptions = {
    specVersion: '1.4',
    rootComponentType: 'library',
    outputLocation: './bom'
};

module.exports = (env, argv) => {
    let config = {
        entry: {
            main: path.resolve(__dirname, 'src/javascript/index')
        },
        output: {
            path: path.resolve(__dirname, 'src/main/resources/javascript/apps/'),
            filename: 'jcr-stats.bundle.js',
            chunkFilename: '[name].jahia.[chunkhash:6].js'
        },
        resolve: {
            mainFields: ['module', 'main'],
            extensions: ['.mjs', '.js', '.jsx', '.json', '.scss'],
            fallback: {url: false}
        },
        module: {
            rules: [
                ...moonstone,
                {
                    test: /\.m?js$/,
                    type: 'javascript/auto'
                },
                {
                    test: /\.jsx?$/,
                    include: [path.join(__dirname, 'src')],
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: [
                                ['@babel/preset-env', {
                                    modules: false,
                                    targets: {chrome: '60', edge: '44', firefox: '54', safari: '12'}
                                }],
                                '@babel/preset-react'
                            ],
                            plugins: ['@babel/plugin-syntax-dynamic-import']
                        }
                    }
                },
                {
                    test: /\.scss$/i,
                    sideEffects: true,
                    use: [
                        'style-loader',
                        {
                            loader: 'css-loader',
                            options: {modules: {localIdentName: '[local]'}}
                        },
                        'sass-loader'
                    ]
                }
            ]
        },
        plugins: [
            new CleanWebpackPlugin({
                cleanOnceBeforeBuildPatterns: [
                    '**/*',
                    '!.well-known',
                    '!.well-known/**/*'
                ]
            }),
            new ModuleFederationPlugin(getModuleFederationConfig(packageJson, {
                remotes: {
                    '@jahia/app-shell': 'appShell',
                    '@jahia/moonstone': 'jahia_moonstone'
                }
            })),
            new CopyWebpackPlugin({
                patterns: [
                    {from: 'package.json', to: ''}
                ]
            }),
            new CycloneDxWebpackPlugin(cycloneDxWebpackPluginOptions)
        ]
    };

    if (argv.mode === 'production') {
        config.devtool = 'source-map';
    } else {
        config.devtool = 'eval-source-map';
    }

    return config;
};
