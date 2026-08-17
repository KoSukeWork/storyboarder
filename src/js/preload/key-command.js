const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderKeyCommands', {
  getData: () => ipcRenderer.sendSync('keyCommands:getData')
})
