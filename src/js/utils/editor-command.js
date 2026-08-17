const path = require('path')

const buildEditorCommand = (editorPath, linkedFilePath, platform = process.platform) => {
  if (
    typeof editorPath !== 'string' || editorPath.length === 0 || editorPath.length > 4096 ||
    editorPath.includes('\0') || !path.isAbsolute(editorPath)
  ) return null
  if (
    typeof linkedFilePath !== 'string' || linkedFilePath.length === 0 || linkedFilePath.length > 4096 ||
    linkedFilePath.includes('\0') || !path.isAbsolute(linkedFilePath)
  ) return null

  if (/\.app$/i.test(editorPath) && platform === 'darwin') {
    return { command: 'open', args: ['-a', editorPath, linkedFilePath] }
  }
  return { command: editorPath, args: [linkedFilePath] }
}

module.exports = { buildEditorCommand }
