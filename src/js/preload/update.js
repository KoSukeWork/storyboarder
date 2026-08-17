const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('storyboarderUpdater', {
  onProgress(callback) {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback({
      percent: Number.isFinite(Number(progress && progress.percent))
        ? Math.max(0, Math.min(100, Number(progress.percent)))
        : 0
    })
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  },
  onReleaseNotes(callback) {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, releaseNotes) => callback(
      typeof releaseNotes === 'string' ? releaseNotes : JSON.stringify(releaseNotes || '')
    )
    ipcRenderer.on('release-notes', listener)
    return () => ipcRenderer.removeListener('release-notes', listener)
  }
})
