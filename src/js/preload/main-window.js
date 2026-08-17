const { contextBridge, ipcRenderer } = require('electron')

// The main workspace is the most privileged-looking page in the application.
// Keep its bridge deliberately boring: renderer code can ask for an allow-listed
// application operation, but it cannot obtain require(), fs, remote or a raw
// WebContents object.
const SEND_CHANNELS = new Set([
  'analyticsEvent', 'analyticsScreen', 'analyticsTiming', 'audio:request-permission',
  'errorInWindow', 'exportPDF:getProjectData-response', 'exportPrintableWorksheetPdf',
  'getCurrentLanguage', 'goBeginning', 'goNext', 'goNextScene', 'goPrevious',
  'goPreviousScene', 'importImagesDialogue', 'languageChanged', 'languageModified',
  'languageAdded', 'languageRemoved', 'log', 'openDialogue', 'openFile',
  'menu:setEnableAudition', 'menu:setMenu', 'menu:setPrintProjectMenu', 'menu:setWelcomeMenu',
  'openLanguagePreferences', 'openNewWindow', 'playsfx', 'preventSleep',
  'prefs:change', 'registration:open', 'resumeSleep', 'test', 'textInputMode',
  'workspaceReady', 'printWorksheet:getProjectData-response', 'mainWindow:fs-sync',
  'mainWindow:window-action', 'mainWindow:clipboard-write', 'mainWindow:native-image'
])

const EVENT_CHANNELS = new Set([
  'addAudioFile', 'brushSize', 'clear', 'copy', 'cycleViewMode', 'deleteBoards',
  'devtools-closed', 'devtools-focused', 'duplicateBoard', 'exportAnimatedGif',
  'exportCleanup', 'exportFcp', 'exportImages', 'exportPDF:getProjectData-request',
  'exportVideo', 'exportWeb', 'exportZIP', 'flipBoard', 'focus', 'goNextBoard',
  'goPreviousBoard', 'importImage', 'importImageAndReplace', 'importNotification',
  'insertNewBoardsWithFiles', 'languageAdded', 'languageChanged', 'languageModified',
  'languageRemoved', 'load', 'newBoard', 'openInEditor', 'paste', 'paste-replace',
  'prefs:change', 'reloadScript', 'redo', 'reorderBoardsLeft', 'reorderBoardsRight',
  'save', 'saveAs', 'scale-ui-by', 'scale-ui-reset', 'setTool', 'showTip',
  'signInSuccess', 'stopAllSounds', 'textInputMode', 'toggleAudition', 'toggleCaptions',
  'toggleGuide', 'toggleNewShot', 'toggleOnionSkin', 'togglePlayback', 'toggleSpeaking',
  'toggleTimeline', 'undo', 'useColor', 'zoomReset', 'exportPrintableWorksheetPdf',
  'addAudioFile', 'printWorksheet:getProjectData-request', 'mainWindow:resize',
  'previousScene', 'nextScene'
])

const INVOKE_CHANNELS = new Set([
  'mainWindow:dialog', 'mainWindow:prefs', 'mainWindow:clipboard-read',
  'mainWindow:native-image-read', 'mainWindow:window', 'mainWindow:project', 'mainWindow:process',
  'mainWindow:auth', 'mainWindow:upload-web'
])

const assertChannel = (set, channel) => {
  if (typeof channel !== 'string' || !set.has(channel)) {
    throw new Error(`Unsupported IPC channel: ${String(channel).slice(0, 128)}`)
  }
}

const ipc = {
  send (channel, ...args) {
    assertChannel(SEND_CHANNELS, channel)
    ipcRenderer.send(channel, ...args)
  },
  sendSync (channel, ...args) {
    assertChannel(SEND_CHANNELS, channel)
    return ipcRenderer.sendSync(channel, ...args)
  },
  invoke (channel, ...args) {
    assertChannel(INVOKE_CHANNELS, channel)
    return ipcRenderer.invoke(channel, ...args)
  },
  on (channel, callback) {
    assertChannel(EVENT_CHANNELS, channel)
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, ...args) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  once (channel, callback) {
    assertChannel(EVENT_CHANNELS, channel)
    if (typeof callback !== 'function') return
    ipcRenderer.once(channel, (_event, ...args) => callback(...args))
  }
}

const invoke = (channel, value) => ipcRenderer.invoke(channel, value)

contextBridge.exposeInMainWorld('storyboarderMain', {
  ipc,
  app: {
    get isPackaged () { return ipcRenderer.sendSync('mainWindow:app-info') === true },
    getAppPath: () => ipcRenderer.sendSync('mainWindow:app-path', '__appPath'),
    getPath: name => ipcRenderer.sendSync('mainWindow:app-path', name)
  },
  dialog: {
    showMessageBox: options => invoke('mainWindow:dialog', { action: 'message', options }),
    showOpenDialog: options => invoke('mainWindow:dialog', { action: 'open', options }),
    showSaveDialog: options => invoke('mainWindow:dialog', { action: 'save', options })
  },
  shell: {
    openExternal: url => invoke('mainWindow:window', { action: 'open-external', url }),
    openPath: filePath => invoke('mainWindow:window', { action: 'open-path', filePath }),
    showItemInFolder: filePath => invoke('mainWindow:window', { action: 'show-item', filePath })
  },
  clipboard: {
    readText: () => ipcRenderer.sendSync('mainWindow:clipboard-read-sync', { action: 'text' }),
    readImage: () => {
      const dataUrl = ipcRenderer.sendSync('mainWindow:clipboard-read-sync', { action: 'image' }) || ''
      return {
        __storyboarderDataUrl: dataUrl,
        isEmpty: () => !dataUrl,
        toDataURL: () => dataUrl
      }
    },
    write: payload => invoke('mainWindow:clipboard-write', payload),
    clear: () => invoke('mainWindow:clipboard-write', { clear: true })
  },
  nativeImage: {
    createFromDataURL: dataUrl => ({ __storyboarderDataUrl: String(dataUrl || '') })
  },
  auth: {
    isAuthenticated: async () => (await invoke('mainWindow:auth', { action: 'status' })).authenticated === true,
    clear: () => invoke('mainWindow:auth', { action: 'clear' })
  },
  window: {
    isFocused: () => ipcRenderer.sendSync('mainWindow:window-action', { action: 'is-focused' }),
    show: () => ipcRenderer.send('mainWindow:window-action', { action: 'show' }),
    hide: () => ipcRenderer.send('mainWindow:window-action', { action: 'hide' }),
    openDevTools: () => ipcRenderer.send('mainWindow:window-action', { action: 'open-devtools' }),
    getBounds: () => ipcRenderer.sendSync('mainWindow:window-action', { action: 'get-bounds' }),
    on: (eventName, callback) => {
      if (eventName === 'focus') return ipc.on('focus', callback)
      if (eventName === 'resize') return ipc.on('mainWindow:resize', callback)
      return () => {}
    }
  },
  // This object is intentionally private-by-convention and only used by the
  // bundled compatibility modules. It still exposes operation names, never a
  // Node module or an arbitrary IPC primitive.
  _internal: Object.freeze({
    fs: request => ipcRenderer.sendSync('mainWindow:fs-sync', request),
    prefs: request => ipcRenderer.sendSync('mainWindow:prefs-sync', request),
    process: { platform: process.platform, type: 'renderer' }
  })
})
