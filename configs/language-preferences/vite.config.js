const { defineConfig } = require('vite')
const react = require('@vitejs/plugin-react')
const commonjs = require('@rollup/plugin-commonjs')
const path = require('path')

module.exports = defineConfig({
  plugins: [react({ jsxRuntime: 'classic' })],
  esbuild: {
    loader: 'jsx',
    include: /\.js$/,
    exclude: []
  },
  build: {
    outDir: path.resolve(__dirname, '../../src/build'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, '../../src/js/windows/language-preferences/window.js'),
      formats: ['iife'],
      name: 'StoryboarderLanguagePreferences',
      fileName: () => 'language-preferences.js'
    },
    rollupOptions: {
      external: [],
      plugins: [commonjs({ include: [/./], transformMixedEsModules: true, defaultIsModuleExports: true, esmExternals: false })],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    },
    commonjsOptions: {
      include: [/node_modules[\\/]/],
      transformMixedEsModules: true
    }
  }
})
