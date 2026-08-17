const assert = require('assert')
const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')

describe('main window preload isolation', function () {
  this.timeout(10000)
  let win
  let handlers

  beforeEach(async () => {
    handlers = []
    const add = (channel, listener) => { handlers.push([channel, listener]); ipcMain.on(channel, listener) }
    add('mainWindow:app-info', event => { event.returnValue = false })
    add('mainWindow:app-path', event => { event.returnValue = path.dirname(__dirname) })
    add('mainWindow:window-action', (_event, request) => { _event.returnValue = request && request.action === 'get-bounds' ? { x: 0, y: 0, width: 800, height: 600 } : true })
    add('mainWindow:prefs-sync', event => { event.returnValue = {} })
    add('mainWindow:fs-sync', event => { event.returnValue = false })
    add('mainWindow:clipboard-read-sync', event => { event.returnValue = '' })
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, '..', '..', 'src', 'js', 'preload', 'main-window.js')
      }
    })
    await win.loadURL('data:text/html,<meta charset="utf-8"><title>Main workspace isolation</title>')
  })

  afterEach(() => {
    for (const [channel, listener] of handlers || []) ipcMain.removeListener(channel, listener)
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  })

  it('does not expose Node or unrestricted IPC', async () => {
    const result = await win.webContents.executeJavaScript(`({
      requireType: typeof require,
      processType: typeof process,
      bridgeType: typeof window.storyboarderMain,
      hasRawRequire: Object.prototype.hasOwnProperty.call(window.storyboarderMain, 'require'),
      rejected: (() => { try { window.storyboarderMain.ipc.send('totally-untrusted-channel'); return false } catch (error) { return true } })()
    })`)
    assert.strictEqual(result.requireType, 'undefined')
    assert.strictEqual(result.processType, 'undefined')
    assert.strictEqual(result.bridgeType, 'object')
    assert.strictEqual(result.hasRawRequire, false)
    assert.strictEqual(result.rejected, true)
  })
})
