const bridge = window.storyboarderMain

const ipcRenderer = {
  send: (channel, ...args) => bridge.ipc.send(channel, ...args),
  sendSync: (channel, ...args) => bridge.ipc.sendSync(channel, ...args),
  invoke: (channel, ...args) => bridge.ipc.invoke(channel, ...args),
  on: (channel, callback) => bridge.ipc.on(channel, (...args) => callback(Object.freeze({}), ...args)),
  once: (channel, callback) => bridge.ipc.once(channel, (...args) => callback(Object.freeze({}), ...args)),
  removeListener: () => {}
}

module.exports = {
  ipcRenderer,
  shell: bridge.shell,
  clipboard: bridge.clipboard,
  nativeImage: bridge.nativeImage,
  app: bridge.app,
  webFrame: { setZoomFactor: value => bridge.ipc.send('mainWindow:window-action', { action: 'set-zoom-factor', value }) },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
}
