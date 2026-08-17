const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const {
  assertReadableFile,
  pathExists,
  resolveForWriteInside,
  sanitizeJsonValue
} = require('../../utils/security')

const MAX_PRESETS_FILE_SIZE = 10 * 1024 * 1024

const getPresetsFolderPath = ({ ensure = false } = {}) => {
  const userDataPath = app.getPath('userData')
  const folderPath = resolveForWriteInside(userDataPath, 'presets')
  if (ensure && !pathExists(folderPath)) fs.mkdirSync(folderPath, { recursive: true })
  if (pathExists(folderPath) && !fs.statSync(folderPath).isDirectory()) {
    throw new Error('Presets path is not a directory')
  }
  return folderPath
}

const getPresetFilePath = (filename, { ensureFolder = false } = {}) => {
  const folderPath = getPresetsFolderPath({ ensure: ensureFolder })
  if (!pathExists(folderPath)) return null
  return resolveForWriteInside(folderPath, filename)
}

// Versions 1.13.0 and before had no priority field for poses.
const migratePosePresets = poses => {
  for (const key of Object.keys(poses)) {
    const pose = poses[key]
    if (pose && typeof pose === 'object' && !Array.isArray(pose)) {
      pose.priority = pose.priority == null ? 0 : pose.priority
    }
  }
  return poses
}

const sanitizePresets = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Preset data must be an object')
  }
  return sanitizeJsonValue(value, {
    maxDepth: 12,
    maxEntries: 100000,
    maxArrayLength: 10000,
    maxStringLength: 1024 * 1024
  })
}

const loadPresetCollection = (filename, key, migrate) => {
  try {
    const filepath = getPresetFilePath(filename)
    if (!filepath || !pathExists(filepath)) return { [key]: undefined }
    const safeFilepath = assertReadableFile(filepath, MAX_PRESETS_FILE_SIZE)
    const data = sanitizePresets(JSON.parse(fs.readFileSync(safeFilepath, 'utf8')))
    return { [key]: migrate ? migrate(data) : data }
  } catch (err) {
    console.warn(`[presets] ignoring invalid ${filename}: ${err.message}`)
    return { [key]: undefined }
  }
}

const savePresetCollection = (filename, value, migrate) => {
  let data = sanitizePresets(value)
  if (migrate) data = migrate(data)
  const string = JSON.stringify(data, null, 2)
  if (Buffer.byteLength(string, 'utf8') > MAX_PRESETS_FILE_SIZE) {
    throw new Error('Preset data exceeds the size limit')
  }
  const filepath = getPresetFilePath(filename, { ensureFolder: true })
  fs.writeFileSync(filepath, string, 'utf8')
}

module.exports = {
  loadScenePresets: () => loadPresetCollection('scenes.json', 'scenes'),
  saveScenePresets: ({ scenes }) => savePresetCollection('scenes.json', scenes),

  loadCharacterPresets: () => loadPresetCollection('characters.json', 'characters'),
  saveCharacterPresets: ({ characters }) => savePresetCollection('characters.json', characters),

  loadPosePresets: () => loadPresetCollection('poses.json', 'poses', migratePosePresets),
  savePosePresets: ({ poses }) => savePresetCollection('poses.json', poses, migratePosePresets),

  loadHandPosePresets: () => loadPresetCollection('hand-poses.json', 'handPoses', migratePosePresets),
  saveHandPosePresets: ({ handPoses }) => savePresetCollection('hand-poses.json', handPoses, migratePosePresets),

  loadEmotionsPresets: () => loadPresetCollection('emotions.json', 'emotions'),
  saveEmotionsPresets: ({ emotions }) => savePresetCollection('emotions.json', emotions)
}
