const dayjs = require('dayjs')
const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const { resolveForWriteInside } = require('../../utils/security')

const allowedOutputFiles = new Map()
const registerOutputFilepath = (root, relativePath) => {
  const filepath = resolveForWriteInside(root, relativePath)
  if (path.extname(filepath).toLowerCase() !== '.pdf') throw new Error('Print output must be a PDF file')
  allowedOutputFiles.set(filepath, { root, relativePath })
  return filepath
}

const createTempFilePath = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-'))
  return registerOutputFilepath(root, 'export.pdf')
}
const temporaryFilepath = createTempFilePath()
const getTemporaryFilepath = () => temporaryFilepath

const getExportFilename = (project, date) => {
  const base = project.scenes.length > 1
    ? path.parse(project.scriptFilepath).name
    : path.parse(project.scenes[0].storyboarderFilePath).name
  return `${base} ${dayjs(date).format('YYYY-MM-DD hh.mm.ss')}.pdf`
}

const getExportFilepath = context => {
  const root = resolveForWriteInside(context.project.root, 'exports')
  fs.ensureDirSync(root)
  return registerOutputFilepath(root, getExportFilename(context.project, new Date()))
}

const assertAllowedOutputFilepath = filepath => {
  if (typeof filepath !== 'string' || filepath.length > 4096 || filepath.includes('\0')) throw new Error('Invalid print output path')
  const record = allowedOutputFiles.get(filepath)
  if (!record) throw new Error('Unrecognized print output path')
  const current = resolveForWriteInside(record.root, record.relativePath)
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
  if (normalize(current) !== normalize(filepath)) throw new Error('Print output path changed after validation')
  return current
}

const prefsAllowlist = [
  'paperSizeKey', 'orientation', 'gridDim', 'direction',
  'enableDialogue', 'enableAction', 'enableNotes', 'enableShotNumber',
  'boardTimeDisplay', 'boardTextSize', 'boardBorderStyle', 'header'
]
const pick = (value, keys) => {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = value[key]
  return result
}

module.exports = {
  getTemporaryFilepath,
  getExportFilepath,
  assertAllowedOutputFilepath,
  toPrefsMemento: context => pick(context, prefsAllowlist),
  fromPrefsMemento: context => pick(context, prefsAllowlist),
  toPresetMemento: context => {
    const result = pick(context, prefsAllowlist)
    delete result.paperSizeKey
    return result
  }
}
