const electron = require('./renderer-electron-shim')
const bridge = window.storyboarderMain

const currentWindow = {
  isFocused: () => bridge.window.isFocused(),
  show: () => bridge.window.show(),
  hide: () => bridge.window.hide(),
  getBounds: () => bridge.window.getBounds(),
  on: (eventName, callback) => bridge.window.on(eventName, callback),
  getChildWindows: () => [],
  webContents: {
    isDevToolsFocused: () => false,
    openDevTools: () => bridge.window.openDevTools(),
    // The legacy renderer installs a before-input-event listener through
    // remote.  Real WebContents objects are intentionally not exposed in the
    // isolated renderer, so retain the method shape as a harmless no-op.
    addListener: () => currentWindow.webContents,
    on: () => currentWindow.webContents,
    setIgnoreMenuShortcuts: () => {}
  }
}

const prefs = {
  init: () => {},
  getPrefs: section => bridge._internal.prefs({ action: 'get', section }),
  set: (name, value, save) => bridge._internal.prefs({ action: 'set', name, value, save }),
  savePrefs: () => bridge._internal.prefs({ action: 'save' })
}

const dialog = {
  showMessageBox: (...args) => bridge.dialog.showMessageBox(args.find(value => value && typeof value === 'object' && !value.webContents) || {}),
  showSaveDialog: (...args) => bridge.dialog.showSaveDialog(args.find(value => value && typeof value === 'object' && !value.webContents) || {}),
  showOpenDialog: (...args) => {
    const options = args.find(value => value && typeof value === 'object' && !value.webContents) || {}
    const callback = args.find(value => typeof value === 'function')
    const promise = bridge.dialog.showOpenDialog(options)
    if (callback) promise.then(result => callback(result.filePaths || []))
    return promise
  }
}

module.exports = {
  ...electron,
  app: electron.app,
  dialog,
  shell: bridge.shell,
  BrowserWindow: Object.assign(function BrowserWindow () {
    throw new Error('Creating windows from the renderer is not supported')
  }, { getAllWindows: () => [currentWindow] }),
  auth: bridge.auth,
  getCurrentWindow: () => currentWindow,
  getCurrentWebContents: () => currentWindow.webContents,
  getGlobal: name => name === 'sharedObj' ? Object.create(null) : undefined,
  require: name => name === './prefs' ? prefs : undefined,
  process: bridge._internal.process
}
