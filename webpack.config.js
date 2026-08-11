const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const argv = require('minimist')(process.argv.slice(2));

// Two named entries so the PNG worker compiles as its own standalone bundle.
// It is loaded at runtime via `new Worker('static/js/png-worker.js')` - a plain
// relative URL, not `new Worker(new URL(..., import.meta.url))` - because the
// app ships as a classic <script src="..."> (no output.module: true), and
// import.meta is only valid inside a real ES module.
let entry = {
    index: [
        'babel-polyfill',
        './src/client/index'
    ],
    'png-worker': './src/client/utils/png/PngWorker.js'
};

let plugins = [];

let devtool = 'eval-source-map';
let outputDir = '';
let debug = true;

// Detect production mode: NODE_ENV=production or --mode production or --prod flag
let prod = process.env.NODE_ENV === 'production' || argv.mode === 'production' || argv.prod || false;

let PLATFORM = argv.platform || 'web';
let mode = prod ? 'production' : 'development';

let target = 'web';
if (PLATFORM === 'electron') target = 'electron-renderer';

plugins.push(new webpack.DefinePlugin({
    'process.env.NODE_ENV': JSON.stringify(mode),
    'PLATFORM': JSON.stringify(PLATFORM)
}));

if (prod) {
    if (PLATFORM === 'web') {
        outputDir = 'web/';
    }

    if (PLATFORM === 'electron') {
        outputDir = '../electron/www/';
    }

    plugins.push(new CopyWebpackPlugin([
        {from: 'src/client/resources', to: outputDir}
    ]));

    devtool = false;
    debug = false;
}
else {
    entry.index.push('webpack-dev-server/client?http://localhost:4000');
    plugins.push(new CopyWebpackPlugin([
        {from: 'src/client/resources', to: './'}
    ]));
}

let config = {
    entry: entry,
    output: {
        path: __dirname + "/dist",
        filename: outputDir + 'static/js/[name].js'
    },
    devServer: {
        static: './dist',
    },
    devtool: devtool,
    target: target,
    mode: mode,
    performance: {
        hints: false,
        maxEntrypointSize: 512000,
        maxAssetSize: 512000
    },
    module: {
        noParse: /.*[\/\\]bin[\/\\].+\.js/,
        rules: [
            {
                test: /.jsx?$/,
                include: [path.resolve(__dirname, 'src')],
                use: [{loader: 'babel-loader', options: {presets: ['@babel/preset-react', '@babel/preset-env']}}]
            },
            {
                test: /\.js$/,
                include: [path.resolve(__dirname, 'src')],
                use: [{loader: 'babel-loader', options: {presets: ['@babel/preset-env']}}]
            },
            {
                test: /\.(html|htm)$/,
                use: [{loader: 'dom'}]
            }
        ]
    },
    // Enable WebAssembly support for Basis Universal encoder
    experiments: {
        asyncWebAssembly: true,
    },
    optimization: {
        minimize: prod,
        usedExports: true,
    },
    plugins: plugins
};

if (target === 'electron-renderer') {
    config.resolve = {alias: {'platform': path.resolve(__dirname, './src/client/platform/electron')}};
} else {
    config.resolve = {alias: {'platform': path.resolve(__dirname, './src/client/platform/web')}};
}

module.exports = config;