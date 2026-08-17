const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderPrintProject', {
  getData: () => ipcRenderer.invoke('exportPDF:getData'),
  generatePreview: context => ipcRenderer.invoke('printProject:generatePreview', context),
  exportPdf: context => ipcRenderer.invoke('printProject:export', context),
  printPdf: request => ipcRenderer.invoke('printProject:print', request),
  showItemInFolder: filename => ipcRenderer.invoke('printProject:showItemInFolder', filename),
  getPrefs: () => ipcRenderer.invoke('printProject:getPrefs'),
  setPrefs: state => ipcRenderer.invoke('printProject:setPrefs', state),
  analytics: (category, action, label, value) => ipcRenderer.send('analyticsEvent', category, action, label, value),
  setMenu: name => ipcRenderer.send('printProject:setMenu', name),
  hide: () => ipcRenderer.send('printProject:hide')
})
