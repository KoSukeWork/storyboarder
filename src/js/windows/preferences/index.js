const { BrowserWindow } = require('electron')
const path = require('path')

module.exports = () => {
  let win

  const show = () => {
    if (win) {
      win.focus()
      return
    }

    win = new BrowserWindow({
      width: 600,
      height: 720,
      show: false,
      center: true,
      resizable: false,
      backgroundColor: '#E5E5E5',
      webPreferences: {
        devTools: true,
        webSecurity: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, '..', '..', 'preload', 'preferences.js')
      }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.on('will-redirect', event => event.preventDefault())

    win.once('closed', () => {
      win = null
    })
    win.loadURL(`file://${__dirname}/../../../preferences.html`)
    win.once('ready-to-show', () => {
      // wait for the DOM to render
      setTimeout(() => {
        win.show()
      }, 125)
    })
  }

  return {
    getWindow: () => win,
    show
  }
}
