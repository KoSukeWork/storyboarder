// Node-only print implementation.  It is intentionally kept out of the
// print renderer; the renderer can request a bounded operation through the
// preload API, but never receives filesystem or child-process access.
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const { pipeline } = require('stream/promises')
const generate = require('../../exporters/pdf')
const createPrint = require('../../print')
const { resolveForWriteInside } = require('../../utils/security')

const MAX_CONFIG_SIZE = 256 * 1024
let activeProject = null

const setProject = project => {
  if (!project || typeof project !== 'object' || !Array.isArray(project.scenes)) {
    throw new Error('Invalid print project')
  }
  activeProject = project
}

const safeConfig = context => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('Invalid print options')
  const source = { ...context }
  delete source.canvas
  delete source.filepath
  delete source.project
  const serialized = JSON.stringify(source)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONFIG_SIZE) throw new Error('Print options are too large')
  const clone = JSON.parse(serialized)
  return clone
}

const tempPdf = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-print-'))
  return { root, filepath: resolveForWriteInside(root, 'preview.pdf') }
}

const writePdf = async (filepath, context) => {
  if (!activeProject) throw new Error('No project is open')
  fs.ensureDirSync(path.dirname(filepath))
  await pipeline(generate({ project: activeProject }, safeConfig(context)), fs.createWriteStream(filepath))
  return filepath
}

const generatePreview = async context => {
  const temp = tempPdf()
  try {
    await writePdf(temp.filepath, context)
    const pdf = fs.readFileSync(temp.filepath)
    return { pdf: pdf.toString('base64') }
  } finally {
    fs.removeSync(temp.root)
  }
}

const exportPdf = async context => {
  if (!activeProject) throw new Error('No project is open')
  const source = activeProject.scenes.length > 1
    ? activeProject.scriptFilepath
    : activeProject.scenes[0].storyboarderFilePath
  const base = path.parse(source).name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'storyboard'
  const root = resolveForWriteInside(activeProject.root, 'exports')
  fs.ensureDirSync(root)
  const filename = `${base} ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.pdf`
  const filepath = resolveForWriteInside(root, filename)
  await writePdf(filepath, context)
  return { filepath }
}

const printPdf = async (context, options = {}) => {
  const temp = tempPdf()
  try {
    await writePdf(temp.filepath, context)
    const print = createPrint({ pathToSumatraExecutable: path.join(process.resourcesPath || '', 'app', 'src', 'data', 'app', 'SumatraPDF.exe') })
    print({
      filepath: temp.filepath,
      paperSize: options.paperSize === 'letter' ? 'letter' : 'a4',
      paperOrientation: options.orientation === 'landscape' ? 'landscape' : 'portrait',
      copies: options.copies
    })
    return { ok: true }
  } finally {
    fs.removeSync(temp.root)
  }
}

module.exports = { setProject, generatePreview, exportPdf, printPdf }
