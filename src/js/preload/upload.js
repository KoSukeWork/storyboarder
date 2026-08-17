const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderUpload', {
  login: credentials => ipcRenderer.invoke('upload:login', credentials),
  signInSuccess: response => ipcRenderer.send('signInSuccess', response),
  hide: () => ipcRenderer.send('upload:hide'),
  openExternal: url => ipcRenderer.invoke('upload:open-external', url)
})
