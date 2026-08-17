const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('storyboarderLanguagePreferences', {
  getData: fileName => invoke('languagePreferences:getData', fileName),
  select: fileName => invoke('languagePreferences:select', fileName),
  save: (fileName, json) => invoke('languagePreferences:save', { fileName, json }),
  add: (displayName, json) => invoke('languagePreferences:add', { displayName, json }),
  remove: fileName => invoke('languagePreferences:remove', fileName),
  export: fileName => invoke('languagePreferences:export', { fileName }),
  import: () => invoke('languagePreferences:import'),
  onLanguageChanged: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = () => callback()
    const channels = ['languageChanged', 'languageModified', 'languageAdded', 'languageRemoved']
    for (const channel of channels) ipcRenderer.on(channel, listener)
    return () => {
      for (const channel of channels) ipcRenderer.removeListener(channel, listener)
    }
  }
})
