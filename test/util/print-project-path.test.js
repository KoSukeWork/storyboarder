const assert = require('assert')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const {
  assertAllowedOutputFilepath,
  getExportFilepath
} = require('../../src/js/windows/print-project/context-helpers')

describe('print project output paths', () => {
  it('only accepts output paths created by the print workflow', () => {
    assert.throws(
      () => assertAllowedOutputFilepath(path.join(os.tmpdir(), 'arbitrary.pdf')),
      /unrecognized/i
    )

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-print-path-'))
    try {
      const filepath = getExportFilepath({
        project: {
          root,
          scenes: [{ storyboarderFilePath: path.join(root, 'scene.storyboarder') }]
        }
      })
      assert.strictEqual(assertAllowedOutputFilepath(filepath), filepath)
      assert.strictEqual(path.dirname(filepath), path.join(root, 'exports'))
    } finally {
      fs.removeSync(root)
    }
  })
})
