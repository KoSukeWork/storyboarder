// via https://egghead.io/lessons/javascript-redux-persisting-the-state-to-the-local-storage
const { app } = electron = require('electron')
const fs = require('fs')
const {
  assertReadableFile,
  resolveForWriteInside,
  sanitizeJsonValue
} = require('../../utils/security')

const MAX_AUTH_FILE_SIZE = 1024 * 1024
const getAuthFilePath = () => resolveForWriteInside(app.getPath('userData'), 'auth.json')

module.exports = {
  loadState: () => {
    try {
      const filepath = getAuthFilePath()
      let data = fs.readFileSync(assertReadableFile(filepath, MAX_AUTH_FILE_SIZE), 'utf8')
      let deserializedState = sanitizeJsonValue(JSON.parse(data), {
        maxDepth: 6,
        maxEntries: 1000,
        maxArrayLength: 100,
        maxStringLength: 65536
      })
      if (!deserializedState || typeof deserializedState !== 'object' || Array.isArray(deserializedState)) return undefined
      return { auth: deserializedState }
    } catch (err) {
      return undefined
    }
  },

  // TODO for better performance, memoize and only save on actual change
  saveState: (state) => {
    try {
      const safeState = sanitizeJsonValue(state.auth, {
        maxDepth: 6,
        maxEntries: 1000,
        maxArrayLength: 100,
        maxStringLength: 65536
      })
      let serializedState = JSON.stringify(safeState)
      if (Buffer.byteLength(serializedState, 'utf8') > MAX_AUTH_FILE_SIZE) return
      fs.writeFileSync(getAuthFilePath(), serializedState)
    } catch (err) {
      // ignore write errors.
    }
  }
}
