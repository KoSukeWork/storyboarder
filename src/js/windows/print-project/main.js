const { BrowserWindow } = require('electron')
const path = require('path')

let win

const show = async ({ parent }) => {
  if (win) {
    return
  }

  let [w, h] = parent.getContentSize()
  let height = Math.floor(h * 0.9)
  let width = Math.floor(height * (w / h))

  win = new BrowserWindow({
    parent,
    show: false,

    width,
    height,

    backgroundColor: '#333333',

    center: true,
    resizable: false,

    modal: true,

    webPreferences: {
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '..', '..', 'preload', 'print-project.js')
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-redirect', event => event.preventDefault())
  win.on('closed', () => { win = null })
  await win.loadFile(path.join(__dirname, 'index.html'))
  win.show()
}

module.exports = {
  show,
  getWindow: () => win
}
