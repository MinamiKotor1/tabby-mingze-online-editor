const path = require('path')
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin')

module.exports = (_env, argv = {}) => {
  const mode = argv.mode === 'production' || process.env.NODE_ENV === 'production'
    ? 'production'
    : 'development'
  const isProduction = mode === 'production'
  const katexFontPath = path.resolve(__dirname, 'node_modules/katex/dist/fonts')

  return {
    target: 'node',
    entry: 'src/index.ts',
    devtool: isProduction ? false : 'source-map',
    context: __dirname,
    mode,
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'index.js',
      clean: true,
      pathinfo: !isProduction,
      libraryTarget: 'umd',
      publicPath: '',
      globalObject: 'this',
      devtoolModuleFilenameTemplate: 'webpack-tabby-mingze-online-editor:///[resource-path]',
    },
    resolve: {
      modules: ['.', 'src', 'node_modules'].map(x => path.join(__dirname, x)),
      extensions: ['.ts', '.js'],
      alias: {
        canvas: false,
      },
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
        {
          test: /\.(woff2?|ttf)$/,
          oneOf: [
            {
              include: katexFontPath,
              // Keep KaTeX math fonts self-contained so injected CSS does not rely on runtime file:// font requests.
              type: 'asset/inline',
            },
            { type: 'asset/resource' },
          ],
        },
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
}
