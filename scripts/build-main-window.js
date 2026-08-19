const path = require('path')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '..')
const preload = name => path.join(root, 'src', 'js', 'preload', name)

const aliases = {
  electron: preload('renderer-electron-shim.js'),
  '@electron/remote': preload('renderer-remote-shim.js'),
  'electron-redux/preload': preload('empty-shim.js'),
  'electron-redux/renderer': preload('electron-redux-renderer-shim.js'),
  'fs': preload('fs-shim.js'),
  'fs-extra': preload('fs-shim.js'),
  'path': preload('path-shim.js'),
  'child_process': preload('child-process-shim.js'),
  'os': preload('os-shim.js'),
  'events': preload('events-shim.js'),
  'util': preload('util-shim.js'),
  'stream': preload('stream-shim.js'),
  'zlib': preload('zlib-shim.js'),
  crypto: preload('crypto-shim.js'),
  url: preload('url-shim.js'),
  assert: preload('assert-shim.js'),
  constants: preload('constants-shim.js'),
  tmp: preload('tmp-shim.js'),
  trash: preload('trash-shim.js'),
  'i18next-fs-backend': preload('i18n-backend-shim.js'),
  'electron-log': preload('log-shim.js'),
  buffer: require.resolve('buffer/'),
  '../menu': preload('menu-shim.js'),
  './menu': preload('menu-shim.js'),
  '../services/i18next.config': path.join(root, 'src', 'js', 'services', 'i18next-browser.js'),
  '../shared/storyboarder-electron-log': preload('log-shim.js')
}

const aliasPlugin = {
  name: 'storyboarder-browser-aliases',
  setup (build) {
    build.onResolve({ filter: /.*/ }, args => {
      const target = aliases[args.path]
      if (target) return { path: target }
      return undefined
    })
  }
}

const options = {
  entryPoints: [path.join(root, 'src', 'js', 'window', 'main-window.js')],
  outfile: path.join(root, 'src', 'build', 'main-window.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  plugins: [aliasPlugin],
  inject: [preload('process-shim.js'), preload('buffer-inject.js')],
  define: { 'process.env.NODE_ENV': '"production"', __dirname: '"."', global: 'globalThis' },
  loader: { '.js': 'jsx', '.json': 'json' },
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  // regenerator-runtime assigns an undeclared global, then falls back to
  // Function() when that throws in the IIFE's strict mode. CSP script-src
  // 'self' blocks that eval and aborts the whole bundle before load.
  banner: { js: 'var regeneratorRuntime;' }
}

const run = process.argv.includes('--watch')
  ? esbuild.context(options).then(context => context.watch())
  : esbuild.build(options)

run.catch(error => {
  console.error(error)
  process.exitCode = 1
})
