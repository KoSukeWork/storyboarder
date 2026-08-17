const assert = require('assert')
const { buildEditorCommand } = require('../../src/js/utils/editor-command')

describe('editor command construction', () => {
  it('passes paths as argv instead of a shell string', () => {
    const result = buildEditorCommand('C:\\Program Files\\Editor.exe', 'C:\\project\\images\\a;&&whoami.psd', 'win32')
    assert.deepStrictEqual(result, {
      command: 'C:\\Program Files\\Editor.exe',
      args: ['C:\\project\\images\\a;&&whoami.psd']
    })
  })

  it('uses open -a for macOS app bundles', () => {
    assert.deepStrictEqual(
      buildEditorCommand('/Applications/Editor.app', '/tmp/project.psd', 'darwin'),
      { command: 'open', args: ['-a', '/Applications/Editor.app', '/tmp/project.psd'] }
    )
  })

  it('rejects non-absolute paths', () => {
    assert.strictEqual(buildEditorCommand('editor.exe', '/tmp/project.psd', 'linux'), null)
  })
})
