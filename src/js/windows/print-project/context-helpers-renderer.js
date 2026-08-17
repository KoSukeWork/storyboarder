// Renderer-safe print context helpers. Absolute filesystem paths are never
// accepted from this page; the main process chooses and validates destinations.
const prefsAllowlist = [
  'paperSizeKey', 'orientation', 'gridDim', 'direction',
  'enableDialogue', 'enableAction', 'enableNotes', 'enableShotNumber',
  'boardTimeDisplay', 'boardTextSize', 'boardBorderStyle', 'header'
]

const pick = (value, keys) => {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = value[key]
  }
  return result
}

module.exports = {
  getTemporaryFilepath: () => '__preview__',
  getExportFilepath: () => '__export__',
  assertAllowedOutputFilepath: value => {
    if (value !== '__preview__' && value !== '__export__') throw new Error('Invalid print output token')
    return value
  },
  toPrefsMemento: context => pick(context, prefsAllowlist),
  fromPrefsMemento: context => pick(context, prefsAllowlist),
  toPresetMemento: context => {
    const result = pick(context, prefsAllowlist)
    delete result.paperSizeKey
    return result
  }
}
