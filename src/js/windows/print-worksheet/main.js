const { BrowserWindow } = require('electron')
const path = require('path')

let win

const show = async ({ parent }) => {
  if (win) {
    win.reload()
    win.show()
    return
  }

  win = new BrowserWindow({
    parent,
    show: false,

    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 600,
    backgroundColor: '#333333',

    center: true,
    resizable: true,

    frame: false,
    modal: true,

    webPreferences: {
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '..', '..', 'preload', 'print-worksheet.js')
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-redirect', event => event.preventDefault())
  win.on('closed', () => (win = null))
  await win.loadFile(path.join(__dirname, 'index.html'))
  win.show()
}

module.exports = {
  show,
  getWindow: () => win
}
