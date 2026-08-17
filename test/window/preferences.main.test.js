const assert = require('assert')
const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')

describe('preferences window isolation', function () {
  this.timeout(10000)
  let win
  let setRequests
  const channels = [
    'preferences:getData',
    'preferences:set',
    'preferences:select-image-editor',
    'preferences:import-watermark',
    'preferences:reveal-keymap',
    'preferences:sign-out',
    'preferences:select-language'
  ]

  const data = {
    prefs: {
      enableTooltips: true,
      enableAutoSave: true,
      enableForcePsdReloadOnFocus: true,
      defaultBoardTiming: 2000,
      enableDiagnostics: false,
      straightLineDelayInMsecs: 500,
      enableNotifications: true,
      enableAspirationalMessages: true,
      allowNotificationsForLineMileage: true,
      enableDrawingSoundEffects: false,
      enableDrawingMelodySoundEffects: false,
      enableUISoundEffects: false,
      enableHighQualityAudio: false,
      enableHighQualityDrawingEngine: true,
      enableCanvasPaintingOpacity: true,
      enableBrushCursor: true,
      enableStabilizer: true,
      absolutePathToImageEditor: undefined,
      userWatermark: undefined
    },
    translations: {
      'preferences.title': '<img src=x onerror=alert(1)>Preferences',
      'preferences.show-tooltips': 'Show Tooltips',
      'preferences.save-automatically': 'Save Automatically',
      'preferences.open-language-editor': 'Edit Languages'
    },
    languages: [{ fileName: 'en-US', displayName: 'English' }],
    selectedLanguage: 'en-US',
    licensed: false,
    accountEmail: null,
    watermarkExists: false
  }

  beforeEach(async () => {
    setRequests = []
    ipcMain.handle('preferences:getData', () => data)
    ipcMain.handle('preferences:set', (event, request) => {
      setRequests.push(request)
      return { ok: true }
    })
    for (const channel of channels.slice(2)) {
      ipcMain.handle(channel, () => ({ ok: true }))
    }
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, '..', '..', 'src', 'js', 'preload', 'preferences.js')
      }
    })
    await win.loadFile(path.join(__dirname, '..', '..', 'src', 'preferences.html'))
  })

  afterEach(() => {
    for (const channel of channels) ipcMain.removeHandler(channel)
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  })

  it('renders text through the preload and restricts preference writes', async () => {
    const result = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const started = Date.now()
      const check = () => {
        const title = document.querySelector('#preferences-title')
        if ((title && title.textContent.includes('Preferences')) || Date.now() - started > 1000) {
          resolve({
            requireType: typeof require,
            processType: typeof process,
            hasBridge: typeof window.storyboarderPreferences === 'object',
            title: title ? title.textContent : '',
            images: title ? title.querySelectorAll('img').length : -1
          })
        } else setTimeout(check, 10)
      }
      check()
    })`)
    assert.strictEqual(result.requireType, 'undefined')
    assert.strictEqual(result.processType, 'undefined')
    assert.strictEqual(result.hasBridge, true)
    assert.strictEqual(result.title, '<img src=x onerror=alert(1)>Preferences')
    assert.strictEqual(result.images, 0)

    await win.webContents.executeJavaScript("document.querySelector('#enableTooltips').click()")
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.deepStrictEqual(setRequests[0], { name: 'enableTooltips', value: false })
  })
})
