const path = require('path')
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin')

const isProduction = process.env.NODE_ENV === 'production'

module.exports = {
  target: 'node',
  entry: 'src/index.ts',
  devtool: isProduction ? false : 'source-map',
  context: __dirname,
  mode: isProduction ? 'production' : 'development',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    pathinfo: !isProduction,
    libraryTarget: 'umd',
    publicPath: '',
    globalObject: 'this',
    devtoolModuleFilenameTemplate: 'webpack-tabby-mingze-online-editor:///[resource-path]',
  },
  resolve: {
    modules: ['.', 'src', 'node_modules'].map(x => path.join(__dirname, x)),
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          configFile: path.resolve(__dirname, 'tsconfig.json'),
        },
      },
      { test: /\.pug$/, use: ['apply-loader', 'pug-loader'] },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.ttf$/, type: 'asset/resource' },
    ],
  },
  externals: [
    'fs',
    'electron',
    '@electron/remote',
    'ngx-toastr',
    'russh',
    'iconv-lite',
    /^rxjs/,
    /^@angular/,
    /^@ng-bootstrap/,
    /^tabby-/,
  ],
  plugins: [
    new MonacoEditorWebpackPlugin({
      languages: ['json'],
    }),
  ],
}
