const { spawnSync, execFile } = require('child_process')
const os = require('os')
const path = require('path')
const fs = require('fs')

const normalizeCopies = value => {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new Error('Number of copies must be an integer between 1 and 99')
  }
  return number
}

const assertPrintableFilepath = value => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error('A valid absolute PDF path is required')
  }
  return value
}

const assertExecutablePath = value => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error('A valid absolute printer executable path is required')
  }
  try {
    if (!fs.statSync(value).isFile()) throw new Error('not a file')
  } catch (err) {
    throw new Error('The configured printer executable is unavailable')
  }
  return value
}

const createPrint = ({
  pathToSumatraExecutable
}) =>
  (
    {
      // absolute filepath to source
      filepath,

      // a4, letter, legal
      paperSize,

      // landscape, portrait
      paperOrientation,

      // number of copies
      copies
    }
  ) => {
    const safeCopies = normalizeCopies(copies)
    const safeFilepath = assertPrintableFilepath(filepath)
    const safePaperSize = paperSize === 'letter' || paperSize === 'a4' ? paperSize : 'a4'
    const safeOrientation = paperOrientation === 'landscape' || paperOrientation === 'portrait'
      ? paperOrientation
      : 'portrait'
    let output

    switch (os.platform()) {
      case 'darwin':
        output = spawnSync('lpr', [
          '-o', `media=${safePaperSize}`,
          ...safeOrientation == 'landscape'
            ? ['-o', 'orientation-requested=4']
            : [],
          '-#', String(safeCopies),
          safeFilepath
        ])
        if (output.error) throw new Error(output.error)
        console.log(output.stdout.toString())
        console.error(output.stderr.toString())
        break

      case 'linux':
        output = spawnSync('lp', [
          '-n', String(safeCopies),
          safeFilepath
        ])
        if (output.error) throw new Error(output.error)
        console.log(output.stdout.toString())
        console.error(output.stderr.toString())
        break

      case 'win32':
        const executable = assertExecutablePath(pathToSumatraExecutable)
        let args = [
          '-print-to-default',
          '-silent',
          '-print-settings',
          `${safeCopies}x`,
          safeFilepath
        ]
        execFile(executable, args, (err, stdout, stderr) => {
          if (err) {
            console.error('error', err)
            throw new Error(err)
          }
          console.log(stdout)
          console.error(stderr)
        })
        break
    }
  }

module.exports = createPrint
