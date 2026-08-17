module.exports = paths => window.storyboarderMain.ipc.invoke('mainWindow:project', {
  action: 'trash',
  paths: Array.isArray(paths) ? paths : [paths]
}).then(result => {
  if (!result || !result.ok) throw new Error('Could not move files to trash')
})
