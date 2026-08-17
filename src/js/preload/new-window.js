const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderNewWindow', {
  getData: () => ipcRenderer.invoke('newWindow:getData'),
  hide: () => ipcRenderer.send('newWindow:hide'),
  openDialogue: () => ipcRenderer.send('openDialogue'),
  createNew: aspectRatio => ipcRenderer.send('createNew', aspectRatio),
  playSfx: name => ipcRenderer.send('playsfx', name),
  setWelcomeMenu: () => ipcRenderer.send('menu:setWelcomeMenu'),
  onSetTab: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = (event, index) => {
      if (index === 0 || index === 1) callback(index)
    }
    ipcRenderer.on('setTab', listener)
    return () => ipcRenderer.removeListener('setTab', listener)
  },
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
