const assert = require('assert')
const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')

describe('key command window isolation', () => {
  let win

  const onGetData = event => {
    event.returnValue = {
      platform: process.platform,
      keymap: {
        'menu:file:save': 'CommandOrControl+s',
        'menu:file:open': 'CommandOrControl+o'
      }
    }
  }

  beforeEach(async () => {
    ipcMain.on('keyCommands:getData', onGetData)
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, '..', '..', 'src', 'js', 'preload', 'key-command.js')
      }
    })
    await win.loadFile(path.join(__dirname, '..', '..', 'src', 'keycommand-window.html'))
  })

  afterEach(() => {
    ipcMain.removeListener('keyCommands:getData', onGetData)
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  })

  it('renders through a narrow preload without Node globals', async () => {
    const result = await win.webContents.executeJavaScript(`({
      requireType: typeof require,
      processType: typeof process,
      hasBridge: typeof window.storyboarderKeyCommands === 'object',
      commandCount: document.querySelectorAll('.command').length,
      keyCount: document.querySelectorAll('#keyboard .key').length
    })`)
    assert.strictEqual(result.requireType, 'undefined')
    assert.strictEqual(result.processType, 'undefined')
    assert.strictEqual(result.hasBridge, true)
    assert(result.commandCount > 0)
    assert(result.keyCount > 0)
  })
})
