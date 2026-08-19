const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderPreferences', {
  getData: () => ipcRenderer.invoke('preferences:getData'),
  setPref: (name, value) => ipcRenderer.invoke('preferences:set', { name, value }),
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  setMcpEnabled: value => ipcRenderer.invoke('mcp:set-enabled', Boolean(value)),
  selectImageEditor: () => ipcRenderer.invoke('preferences:select-image-editor'),
  importWatermark: () => ipcRenderer.invoke('preferences:import-watermark'),
  revealKeymap: () => ipcRenderer.invoke('preferences:reveal-keymap'),
  signOut: () => ipcRenderer.invoke('preferences:sign-out'),
  selectLanguage: fileName => ipcRenderer.invoke('preferences:select-language', fileName),
  openLanguagePreferences: () => ipcRenderer.send('openLanguagePreferences'),
  notifyChanges: changes => ipcRenderer.send('prefs:change', changes),
  onLanguageDataChanged: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = () => callback()
    const channels = ['languageChanged', 'languageModified', 'languageAdded', 'languageRemoved']
    for (const channel of channels) ipcRenderer.on(channel, listener)
    return () => {
      for (const channel of channels) ipcRenderer.removeListener(channel, listener)
    }
  }
})
