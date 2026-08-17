// REFERENCE
// https://github.com/iffy/electron-updater-example/blob/master/main.js
// https://github.com/wulkano/kap/blob/b326a5a/app/src/main/auto-updater.js

const { BrowserWindow, dialog, app } = electron = require('electron')
const path = require('path')
const log = require('./shared/storyboarder-electron-log')
const { autoUpdater } = require('electron-updater')

log.transports.file.level = 'info'
autoUpdater.logger = log

const init = () => {
  autoUpdater.on('checking-for-update', () => {
    log.info('auto-updater: checking-for-update')
  })

  autoUpdater.on('update-available', (ev, info) => {
    log.info('auto-updater: update-available')
    const version = typeof ev.version === 'string' ? ev.version.slice(0, 128) : 'a new version'
    const index = dialog.showMessageBoxSync(
      null,
      {
        type: 'question',
        message: `An update is available to version ${version}. Update now? There will be a short delay while we download the update and install it for you.`,
        buttons: ['Later', 'Download and Install Now']
      }
    )

    if (index == 1) {
      // On Windows, this causes an error. Skipping for now.
      // BrowserWindow.getAllWindows().forEach(w => w.close())

      let win
      win = new BrowserWindow({
        width: 600,
        height: 720,
        show: false,
        center: true,
        resizable: false,
        backgroundColor: '#E5E5E5',
        webPreferences: {
          preload: path.join(__dirname, 'preload', 'update.js'),
          nodeIntegration: false,
          devTools: true,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true
        }
      })
      win.on('closed', () => {
        win = null
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', event => event.preventDefault())
      win.webContents.on('will-redirect', event => event.preventDefault())
      win.loadFile(path.join(__dirname, '../update.html'))
      win.once('ready-to-show', () => {
        let releaseNotes = ev.releaseNotes
        if (typeof releaseNotes !== 'string') {
          try { releaseNotes = JSON.stringify(releaseNotes || '') } catch (err) { releaseNotes = '' }
        }
        win.webContents.send('release-notes', releaseNotes.slice(0, 256 * 1024))
        win.show()
      })

      autoUpdater.on('download-progress', (progressObj) => {
        log.info('auto-updater: progress', progressObj)
        win && win.webContents.send('progress', progressObj)
      })

      autoUpdater.on('update-downloaded', (ev, info) => {
        log.info('auto-updater: update-downloaded')
        dialog.showMessageBox(null, { message: 'Update downloaded; will install in 5 seconds' })
        // Wait 5 seconds, then quit and install
        // In your application, you don't need to wait 5 seconds.
        // You could call autoUpdater.quitAndInstall(); immediately
        setTimeout(() => autoUpdater.quitAndInstall(), 5000)
      })

      // fail gracelessly if we can't update properly
      autoUpdater.on('error', err => {
        log.info('auto-updater: error', err)
        dialog.showMessageBox(null, { message: 'Update failed. Please try again later.' })
        win && win.close()
      })

      // Download and Install
      log.info('auto-updater: autoUpdater.downloadUpdate()')
      autoUpdater.downloadUpdate().catch(err => {
        log.info('auto-updater: download failed', err)
      })
    }
  })

  autoUpdater.on('update-not-available', (ev, info) => {
    log.info('auto-updater: update-not-available')
  })

  autoUpdater.on('error', (err) => {
    log.info('auto-updater: error', err)
    console.error(err)
  })

  autoUpdater.autoDownload = false
  autoUpdater.checkForUpdates().catch(err => {
    log.info('auto-updater: update check failed', err)
  })
}

exports.init = init
