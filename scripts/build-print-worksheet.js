const path = require('path')
const esbuild = require('esbuild')

const options = {
  entryPoints: [path.resolve(__dirname, '../src/js/windows/print-worksheet/window.js')],
  outfile: path.resolve(__dirname, '../src/build/print-worksheet.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
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
