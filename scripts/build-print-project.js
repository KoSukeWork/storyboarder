const path = require('path')
const esbuild = require('esbuild')

const options = {
  entryPoints: [path.resolve(__dirname, '../src/js/windows/print-project/window.js')],
  outfile: path.resolve(__dirname, '../src/build/print-project.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  minify: false,
  sourcemap: false
}

const run = process.argv.includes('--watch')
  ? esbuild.context(options).then(context => context.watch())
  : esbuild.build(options)

run.catch(error => {
  console.error(error)
  process.exitCode = 1
})
