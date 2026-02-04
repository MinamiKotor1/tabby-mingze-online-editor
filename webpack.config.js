const path = require('path')
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin')

module.exports = {
  target: 'node',
  entry: 'src/index.ts',
  devtool: 'source-map',
  context: __dirname,
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    pathinfo: true,
    libraryTarget: 'umd',
    // Do not use "auto" here: Tabby loads plugins via Node `require()` (no <script src>),
    // so webpack can't infer the bundle URL and will throw at startup.
    // We set the real public path at runtime in src/index.ts via __webpack_public_path__.
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
    /^rxjs/,
    /^@angular/,
    /^@ng-bootstrap/,
    /^tabby-/,
  ],
  plugins: [
    // Keep Monaco defaults for now (find, go-to-line, common keybindings, etc.)
    new MonacoEditorWebpackPlugin(),
  ],
}
