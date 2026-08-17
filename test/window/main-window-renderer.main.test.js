const assert = require('assert')
const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const { BrowserWindow, ipcMain } = require('electron')

describe('main window renderer bundle', function () {
  this.timeout(15000)
  let win
  let rendererMessages
  let handlers

  beforeEach(async () => {
    rendererMessages = []
    handlers = []
    const add = (channel, listener) => { handlers.push([channel, listener]); ipcMain.on(channel, listener) }
    const root = path.join(__dirname, '..', '..')
    const bundle = path.join(root, 'src', 'build', 'main-window.js')
    if (!fs.existsSync(bundle)) childProcess.execFileSync(process.execPath, [path.join(root, 'scripts', 'build-main-window.js')], { stdio: 'inherit' })
    add('mainWindow:app-info', event => { event.returnValue = false })
    add('mainWindow:app-path', event => { event.returnValue = root })
    add('mainWindow:window-action', (event, request) => { event.returnValue = request && request.action === 'get-bounds' ? { x: 0, y: 0, width: 1280, height: 720 } : true })
    add('mainWindow:prefs-sync', event => { event.returnValue = {} })
    add('mainWindow:fs-sync', event => { event.returnValue = false })
    add('mainWindow:clipboard-read-sync', event => { event.returnValue = '' })
    add('getCurrentLanguage', event => { event.returnValue = 'en-US' })
    add('errorInWindow', (_event, ...args) => { rendererMessages.push(args.join(' ')) })
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(root, 'src', 'js', 'preload', 'main-window.js')
      }
    })
    win.webContents.on('console-message', event => rendererMessages.push(`${event.message} ${event.sourceId || ''}:${event.lineNumber || 0}`))
    await win.loadFile(path.join(root, 'src', 'main-window.html'))
  })

  afterEach(() => {
    for (const [channel, listener] of handlers || []) ipcMain.removeListener(channel, listener)
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  })

  it('loads without exposing Node globals', async () => {
    const result = await win.webContents.executeJavaScript(`({
      loaded: document.documentElement.dataset.storyboarderRenderer,
      requireType: typeof require,
      processType: typeof process,
      bridgeType: typeof window.storyboarderMain
    })`)
    assert.strictEqual(result.loaded, 'loaded', rendererMessages.join('\n'))
    assert.strictEqual(result.requireType, 'undefined')
    assert.strictEqual(result.processType, 'undefined')
    assert.strictEqual(result.bridgeType, 'object')
  })
})
