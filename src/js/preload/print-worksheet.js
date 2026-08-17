const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderPrintWorksheet', {
  getData: () => ipcRenderer.invoke('printWorksheet:getData'),
  generate: options => ipcRenderer.invoke('printWorksheet:generate', options),
  print: options => ipcRenderer.invoke('printWorksheet:print', options),
  exportPdf: options => ipcRenderer.invoke('printWorksheet:export', options),
  getState: () => ipcRenderer.invoke('printWorksheet:getState'),
  setState: state => ipcRenderer.invoke('printWorksheet:setState', state),
  playSfx: name => ipcRenderer.send('playsfx', name),
  hide: () => ipcRenderer.send('printWorksheet:hide')
})
