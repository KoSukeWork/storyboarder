const assert = require('assert')
const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const { BrowserWindow, ipcMain } = require('electron')

describe('language preferences window isolation', function () {
  this.timeout(10000)
  let win
  const channels = [
    'languagePreferences:getData',
    'languagePreferences:select',
    'languagePreferences:save',
    'languagePreferences:add',
    'languagePreferences:remove',
    'languagePreferences:export',
    'languagePreferences:import'
  ]
  const data = {
    languages: [{ fileName: 'en-US', displayName: 'English', builtIn: true }],
    selectedLanguage: 'en-US',
    json: { Name: '<img src=x onerror=alert(1)>', nested: 'plain text' }
  }

  beforeEach(async () => {
    const bundle = path.join(__dirname, '..', '..', 'src', 'build', 'language-preferences.js')
    if (!fs.existsSync(bundle)) childProcess.execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'build-language-preferences.js')], { stdio: 'inherit' })
    ipcMain.handle('languagePreferences:getData', () => data)
    for (const channel of channels.slice(1)) ipcMain.handle(channel, () => ({ ok: true, data }))
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, '..', '..', 'src', 'js', 'preload', 'language-preferences.js')
      }
    })
    await win.loadFile(path.join(__dirname, '..', '..', 'src', 'language-preferences.html'))
  })

  afterEach(() => {
    for (const channel of channels) ipcMain.removeHandler(channel)
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  })

  it('has no Node globals and renders language values as text', async () => {
    const result = await win.webContents.executeJavaScript(`window.storyboarderLanguagePreferences.getData().then(data => new Promise(resolve => {
      const started = Date.now()
      const check = () => {
        const root = document.querySelector('.language-editor')
        if ((root && root.textContent.includes('<img src=x')) || Date.now() - started > 2000) {
          resolve({
            requireType: typeof require,
            processType: typeof process,
            hasBridge: typeof window.storyboarderLanguagePreferences === 'object',
            text: root ? root.textContent : '',
            images: root ? root.querySelectorAll('img').length : -1
          })
        } else setTimeout(check, 10)
      }
      check()
    }))`)
    assert.strictEqual(result.requireType, 'undefined')
    assert.strictEqual(result.processType, 'undefined')
    assert.strictEqual(result.hasBridge, true)
    assert(result.text.includes('<img src=x'))
    assert.strictEqual(result.images, 0)
  })
})
