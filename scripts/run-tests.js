const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

function findTestFiles (dir, pattern) {
  const files = []
  function walk (d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(entry => {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && pattern.test(entry.name)) files.push(full)
    })
  }
  walk(dir)
  return files
}

const testDir = path.resolve(__dirname, '..', 'test')

const runNodeScript = (packageName, relativeBin, args) => {
  const entry = path.resolve(__dirname, '..', 'node_modules', packageName, relativeBin)
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status == null ? 1 : result.status)
}

const unitTests = findTestFiles(testDir, /(?<!\.renderer)(?<!\.main)\.test\.js$/)
if (unitTests.length) {
  console.log(`Running ${unitTests.length} unit test(s)...`)
  runNodeScript('mocha', path.join('bin', 'mocha.js'), unitTests)
}

const rendererTests = findTestFiles(testDir, /\.renderer\.test\.js$/)
if (rendererTests.length) {
  console.log(`Running ${rendererTests.length} renderer test(s)...`)
  runNodeScript('electron-mocha', path.join('bin', 'electron-mocha'), ['--renderer', ...rendererTests])
}

const mainTests = findTestFiles(testDir, /\.main\.test\.js$/)
if (mainTests.length) {
  console.log(`Running ${mainTests.length} main process test(s)...`)
  runNodeScript('electron-mocha', path.join('bin', 'electron-mocha'), mainTests)
}

console.log('All tests complete.')
