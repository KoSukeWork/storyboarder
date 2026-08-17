const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderWelcome', {
  getData: () => ipcRenderer.invoke('welcome:getData'),
  close: () => ipcRenderer.send('welcome:close'),
  openFile: filepath => ipcRenderer.send('openFile', filepath),
  openDialog: () => ipcRenderer.send('openDialogue'),
  openNewWindow: () => ipcRenderer.send('openNewWindow'),
  openExternal: url => ipcRenderer.invoke('welcome:openExternal', url),
  playSfx: name => ipcRenderer.send('playsfx', name),
  setMenu: () => ipcRenderer.send('welcome:setMenu'),
  onRecentDocumentsChanged: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = () => callback()
    ipcRenderer.on('updateRecentDocuments', listener)
    return () => ipcRenderer.removeListener('updateRecentDocuments', listener)
  },
  onLanguageChanged: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = () => callback()
    for (const channel of ['languageChanged', 'languageModified', 'languageAdded', 'languageRemoved']) ipcRenderer.on(channel, listener)
    return () => {
      for (const channel of ['languageChanged', 'languageModified', 'languageAdded', 'languageRemoved']) ipcRenderer.removeListener(channel, listener)
    }
  }
})
