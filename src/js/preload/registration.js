const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderRegistration', {
  request: (request) => ipcRenderer.invoke('registration:request', request),
  installLicense: (request) => ipcRenderer.invoke('registration:install-license', request),
  removeLicense: () => ipcRenderer.invoke('registration:remove-license'),
  hasLicense: () => ipcRenderer.invoke('registration:has-license'),
  signInSuccess: response => ipcRenderer.send('signInSuccess', response),
  hide: () => ipcRenderer.send('registration:hide'),
  openExternal: url => ipcRenderer.invoke('shell:open-external', url)
})
