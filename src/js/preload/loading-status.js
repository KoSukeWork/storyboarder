const { contextBridge, ipcRenderer } = require('electron')

// The loading window only needs a one-way, bounded stream of status messages.
// Keep the bridge deliberately narrow so a malformed status payload cannot
// obtain a general-purpose IPC or filesystem capability.
contextBridge.exposeInMainWorld('storyboarderLoadingStatus', {
  onLog(callback) {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      const type = value.type === 'progress' || value.type === 'error' ? value.type : null
      if (!type || typeof value.message !== 'string') return
      callback({
        type,
        message: value.message.slice(0, 4096)
      })
    }
    ipcRenderer.on('log', listener)
    return () => ipcRenderer.removeListener('log', listener)
  }
})
