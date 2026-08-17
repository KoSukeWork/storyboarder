const assert = require('assert')
const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')

describe('new project window isolation', () => {
  let win

  beforeEach(async () => {
    ipcMain.handle('newWindow:getData', () => ({
      translations: {
        'new-window.creation-title': '<img src=x onerror=alert(1)>Create safely',
        'new-window.new-script': 'New Script',
        'new-window.new-blank': 'New Blank'
      }
    }))
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, '..', '..', 'src', 'js', 'preload', 'new-window.js')
      }
    })
    await win.loadFile(path.join(__dirname, '..', '..', 'src', 'new.html'))
  })

  afterEach(() => {
    ipcMain.removeHandler('newWindow:getData')
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  })

  it('renders translations as text through a narrow preload', async () => {
    const result = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const started = Date.now()
      const check = () => {
        const title = document.querySelector('#creation-title')
        if ((title && title.textContent.includes('Create safely')) || Date.now() - started > 1000) {
          resolve({
            requireType: typeof require,
            processType: typeof process,
            hasBridge: typeof window.storyboarderNewWindow === 'object',
            title: title ? title.textContent : '',
            injectedImages: title ? title.querySelectorAll('img').length : -1
          })
        } else {
          setTimeout(check, 10)
        }
      }
      check()
    })`)
    assert.strictEqual(result.requireType, 'undefined')
    assert.strictEqual(result.processType, 'undefined')
    assert.strictEqual(result.hasBridge, true)
    assert.strictEqual(result.title, '<img src=x onerror=alert(1)>Create safely')
    assert.strictEqual(result.injectedImages, 0)
  })
})
