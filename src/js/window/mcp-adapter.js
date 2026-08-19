const fs = require('fs-extra')
const path = require('path')
const os = require('os')

const boardModel = require('../models/board')

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 16384
const ALLOWED_LAYERS = new Set(['reference', 'fill', 'tone', 'pencil', 'ink', 'notes'])
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg'])
const ALLOWED_IMAGE_KINDS = new Set(['thumbnail', 'composite', 'reference', 'fill', 'tone', 'pencil', 'ink', 'notes', 'shot-generator'])
const ALLOWED_EXPORT_FORMATS = new Set(['pdf', 'images', 'gif', 'video', 'fcpxml', 'zip'])

class AdapterError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'AdapterError'
    this.code = code
  }
}

const clone = value => JSON.parse(JSON.stringify(value == null ? null : value))
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const text = value => value == null ? '' : String(value)
const clampText = value => text(value).slice(0, 256 * 1024)
const publicMediaFilename = value => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || path.isAbsolute(value)) return undefined
  const normalized = value.replace(/\\/g, '/')
  if (normalized.split('/').some(part => part === '..' || part === '' || part === '.') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.includes(':')) return undefined
  return normalized
}
const publicMediaDescription = media => {
  if (!media || typeof media !== 'object') return {}
  const result = {}
  for (const key of ['layers', 'layerThumbnails']) {
    result[key] = {}
    for (const [name, filename] of Object.entries(media[key] || {})) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) continue
      const safe = publicMediaFilename(filename)
      if (safe) result[key][name] = safe
    }
  }
  for (const key of ['thumbnail', 'posterframe', 'link', 'audio']) {
    const safe = publicMediaFilename(media[key])
    if (safe) result[key] = safe
  }
  if (media.sg && typeof media.sg === 'object') {
    const safe = publicMediaFilename(media.sg.plot)
    if (safe) result.sg = { plot: safe }
  }
  return result
}

const asError = error => error instanceof AdapterError
  ? error
  : new AdapterError('INTERNAL_ERROR', error && error.message ? error.message : 'MCP operation failed')

const mediaKindToFilename = (board, kind) => {
  if (!ALLOWED_IMAGE_KINDS.has(kind)) return null
  if (kind === 'thumbnail') return boardModel.boardFilenameForThumbnail(board)
  if (kind === 'composite') return boardModel.boardFilenameForPosterFrame(board)
  if (kind === 'shot-generator') return board.layers && board.layers['shot-generator'] && board.layers['shot-generator'].url
  return board.layers && board.layers[kind] && board.layers[kind].url
}

const mimeTypeForFilename = filename => path.extname(String(filename || '')).toLowerCase() === '.jpg' ||
  path.extname(String(filename || '')).toLowerCase() === '.jpeg'
  ? 'image/jpeg'
  : 'image/png'

const summarizeShotGenerator = board => {
  if (!board || !board.sg || !board.sg.data || !board.sg.data.sceneObjects) return null
  const objects = Object.values(board.sg.data.sceneObjects)
  const counts = {}
  for (const object of objects) {
    if (!object || typeof object.type !== 'string') continue
    counts[object.type] = (counts[object.type] || 0) + 1
  }
  const activeCameraId = board.sg.data.activeCamera
  const activeCamera = objects.find(object => object && object.id === activeCameraId && object.type === 'camera')
  return {
    version: text(board.sg.version || ''),
    objectCounts: counts,
    activeCamera: activeCamera
      ? {
          id: activeCamera.id,
          displayName: activeCamera.displayName,
          fov: activeCamera.fov,
          x: activeCamera.x,
          y: activeCamera.y,
          z: activeCamera.z,
          rotation: activeCamera.rotation,
          tilt: activeCamera.tilt,
          roll: activeCamera.roll
        }
      : null
  }
}

const boardSummary = (board, scene) => ({
  uid: board.uid,
  number: Number.isFinite(Number(board.number)) ? Number(board.number) : null,
  shot: clampText(board.shot),
  time: Number(board.time) || 0,
  duration: boardModel.boardDuration(scene, board),
  newShot: Boolean(board.newShot),
  action: clampText(board.action),
  dialogue: clampText(board.dialogue),
  notes: clampText(board.notes),
  audio: board.audio && typeof board.audio === 'object'
    ? { filename: publicMediaFilename(board.audio.filename), duration: Number(board.audio.duration) || 0 }
    : null,
  layers: board.layers && typeof board.layers === 'object'
    ? Object.keys(board.layers).filter(name => typeof name === 'string' && name.length <= 64)
    : [],
  media: publicMediaDescription(boardModel.getMediaDescription(board)),
  shotGenerator: summarizeShotGenerator(board)
})

const sceneSummary = (scene, sceneInfo) => ({
  revision: sceneInfo.revision,
  scene: sceneInfo.scene,
  version: scene.version,
  aspectRatio: Number(scene.aspectRatio),
  fps: Number(scene.fps),
  defaultBoardTiming: Number(scene.defaultBoardTiming),
  boardCount: Array.isArray(scene.boards) ? scene.boards.length : 0,
  boards: Array.isArray(scene.boards) ? scene.boards.map(board => boardSummary(board, scene)) : []
})

const readPngDimensions = data => {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a ||
      data.readUInt32BE(8) !== 0x0000000d || data.toString('ascii', 12, 16) !== 'IHDR') return null
  let offset = 8
  let sawIdat = false
  let sawIend = false
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    if (length > data.length - offset - 12) return null
    const type = data.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') {
      sawIend = length === 0
      break
    }
    offset += length + 12
  }
  if (!sawIdat || !sawIend) return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

const readJpegDimensions = data => {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) return null
    while (offset < data.length && data[offset] === 0xff) offset++
    if (offset >= data.length) return null
    const marker = data[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 1 >= data.length) return null
    const length = data.readUInt16BE(offset)
    if (length < 2 || offset + length > data.length) return null
    const isFrame = (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isFrame && length >= 7) {
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  return null
}

const imageDimensions = (data, mimeType) => mimeType === 'image/png'
  ? readPngDimensions(data)
  : readJpegDimensions(data)

const dataUrlFromSource = source => {
  if (!source || !ALLOWED_IMAGE_TYPES.has(source.mimeType) || typeof source.dataBase64 !== 'string') {
    throw new AdapterError('VALIDATION_FAILED', 'Only inline PNG and JPEG images are supported')
  }
  const encoded = source.dataBase64
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1 ||
      (encoded.includes('=') && encoded.indexOf('=') < encoded.length - 2 && encoded.indexOf('=') !== encoded.length - 1)) {
    throw new AdapterError('VALIDATION_FAILED', 'Image data is not valid Base64')
  }
  let data
  try {
    data = Buffer.from(encoded, 'base64')
  } catch (err) {
    throw new AdapterError('VALIDATION_FAILED', 'Image data is not valid Base64')
  }
  if (!data.length || data.length > MAX_IMAGE_BYTES) throw new AdapterError('VALIDATION_FAILED', 'Image exceeds the 20 MiB limit')
  const dimensions = imageDimensions(data, source.mimeType)
  if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) ||
      dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    throw new AdapterError('VALIDATION_FAILED', 'Image is not a valid PNG/JPEG or exceeds the 16384px dimension limit')
  }
  return {
    buffer: data,
    dataUrl: `data:${source.mimeType};base64,${data.toString('base64')}`,
    width: dimensions.width,
    height: dimensions.height
  }
}

const safeFileInfo = (ctx, filename) => {
  try {
    const absolute = ctx.safeMediaPath(filename)
    if (!absolute || !fs.existsSync(absolute)) return null
    const stat = fs.statSync(absolute)
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null
    return {
      mimeType: mimeTypeForFilename(filename),
      dataBase64: fs.readFileSync(absolute, 'base64'),
      size: stat.size
    }
  } catch (err) {
    return null
  }
}

const safeReferencedFileExists = (ctx, filename) => {
  if (typeof filename !== 'string' || !filename.length || !ctx.safeMediaPath) return false
  const absolute = ctx.safeMediaPath(filename)
  if (!absolute || !fs.existsSync(absolute)) return false
  try { return fs.statSync(absolute).isFile() } catch (err) { return false }
}

const previewText = value => JSON.stringify(value, null, 2)
const PREVIEW_TIMEOUT_MS = 5 * 60 * 1000

const showPreview = (summary, images = [], getRevision) => new Promise(resolve => {
  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'inset:8%', 'background:#222', 'color:#fff',
    'border:1px solid #666', 'border-radius:8px', 'box-shadow:0 20px 80px rgba(0,0,0,.65)',
    'display:flex', 'flex-direction:column', 'font-family:system-ui,sans-serif'
  ].join(';')

  const heading = document.createElement('div')
  heading.style.cssText = 'padding:16px 20px;font-size:18px;font-weight:600;border-bottom:1px solid #555'
  heading.textContent = 'MCP change preview'
  root.appendChild(heading)

  const body = document.createElement('div')
  body.style.cssText = 'overflow:auto;flex:1;padding:16px 20px;white-space:pre-wrap'
  const detail = document.createElement('pre')
  detail.style.cssText = 'margin:0;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap'
  detail.textContent = previewText(summary)
  body.appendChild(detail)

  for (const image of images.slice(0, 8)) {
    if (!image || typeof image.dataUrl !== 'string') continue
    const img = document.createElement('img')
    img.src = image.dataUrl
    img.alt = image.label || 'MCP image preview'
    img.style.cssText = 'max-width:220px;max-height:140px;object-fit:contain;margin:8px;border:1px solid #777'
    body.appendChild(img)
  }
  root.appendChild(body)

  const footer = document.createElement('div')
  footer.style.cssText = 'padding:12px 20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #555'
  const reject = document.createElement('button')
  reject.textContent = 'Reject'
  const accept = document.createElement('button')
  accept.textContent = 'Apply changes'
  accept.style.fontWeight = '600'
  footer.append(reject, accept)
  root.appendChild(footer)
  document.body.appendChild(root)

  let settled = false
  const finish = value => {
    if (settled) return
    settled = true
    clearInterval(revisionTimer)
    clearTimeout(expiryTimer)
    root.remove()
    resolve(value)
  }
  reject.onclick = () => finish({ status: 'rejected' })
  accept.onclick = () => finish({ status: 'approved' })
  const expiryTimer = setTimeout(() => finish({ status: 'expired' }), PREVIEW_TIMEOUT_MS)
  const revisionTimer = setInterval(() => {
    if (typeof summary.baseRevision === 'number' && typeof getRevision === 'function' && getRevision() !== summary.baseRevision) {
      finish({ status: 'conflict' })
    }
  }, 500)
})

const createMcpAdapter = context => {
  const ctx = context
  let writeInProgress = false

  const getScene = () => {
    const scene = ctx.getBoardData()
    if (!scene) throw new AdapterError('NO_PROJECT', 'No Storyboarder project is open')
    if (!Array.isArray(scene.boards)) throw new AdapterError('NO_SCENE', 'No Storyboarder scene is open')
    return scene
  }

  const getBoard = uid => {
    const scene = getScene()
    const board = scene.boards.find(item => item && item.uid === uid)
    if (!board) throw new AdapterError('NOT_FOUND', `Board ${uid} was not found`)
    return board
  }

  const getContext = () => {
    const scene = getScene()
    const current = scene.boards[ctx.getCurrentBoardIndex()] || null
    return {
      ok: true,
      revision: ctx.getRevision(),
      appVersion: ctx.appVersion,
      project: {
        type: ctx.getScriptData() ? 'script' : 'storyboard',
        fileName: ctx.getProjectBaseName(),
        hasScript: Boolean(ctx.getScriptData())
      },
      scene: ctx.getCurrentSceneInfo(),
      dirty: typeof ctx.getDirtyState === 'function' ? ctx.getDirtyState() : { project: false, image: false, any: false },
      selection: {
        currentBoardUid: current && current.uid,
        currentBoardIndex: ctx.getCurrentBoardIndex(),
        selectedBoardUids: typeof ctx.getSelectedBoardIndices === 'function'
          ? ctx.getSelectedBoardIndices().map(index => scene.boards[index] && scene.boards[index].uid).filter(Boolean)
          : current && current.uid ? [current.uid] : []
      },
      settings: {
        aspectRatio: Number(scene.aspectRatio),
        fps: Number(scene.fps),
        defaultBoardTiming: Number(scene.defaultBoardTiming)
      },
      capabilities: {
        writeRequiresApproval: true,
        imageInput: ['image/png', 'image/jpeg'],
        imageLayers: Array.from(ALLOWED_LAYERS),
        exports: ['pdf', 'images', 'gif', 'video', 'fcpxml', 'zip']
      }
    }
  }

  const getScript = () => {
    const data = ctx.getScriptData()
    if (!data) return { ok: false, available: false, revision: ctx.getRevision(), reason: 'The open project has no Fountain or Final Draft script' }
    return {
      ok: true,
      available: true,
      revision: ctx.getRevision(),
      fileType: path.extname(ctx.getScriptFilePath() || '').toLowerCase().slice(1),
      scenes: data.filter(node => node && node.type === 'scene').map(node => ({
        sceneId: node.scene_id,
        number: node.scene_number,
        slugline: clampText(node.slugline),
        synopsis: clampText(node.synopsis),
        duration: Number(node.duration) || 0,
        script: Array.isArray(node.script)
          ? node.script.slice(0, 10000).map(item => ({
              type: item.type,
              text: clampText(item.text),
              character: clampText(item.character),
              dialogue: clampText(item.dialogue),
              action: clampText(item.action)
            }))
          : []
      })),
      locations: (ctx.getLocations() || []).slice(0, 10000),
      characters: (ctx.getCharacters() || []).slice(0, 10000)
    }
  }

  const listScenes = includeCompleted => {
    const data = ctx.getScriptData()
    if (!data) return { ok: true, revision: ctx.getRevision(), scenes: [] }
    const currentInfo = ctx.getCurrentSceneInfo() || {}
    const scenes = data.filter(node => node && node.type === 'scene').map(node => {
      const isCurrent = (node.scene_id != null && node.scene_id === currentInfo.sceneId) ||
        (node.scene_number != null && Number(node.scene_number) - 1 === ctx.getCurrentSceneIndex())
      return {
        sceneId: node.scene_id,
        number: node.scene_number,
        slugline: clampText(node.slugline),
        synopsis: clampText(node.synopsis),
        current: isCurrent,
        loaded: isCurrent,
        boardCount: isCurrent ? getScene().boards.length : null,
        complete: isCurrent ? getScene().boards.length > 0 : false
      }
    })
    return { ok: true, revision: ctx.getRevision(), scenes: includeCompleted ? scenes : scenes.filter(scene => !scene.complete) }
  }

  const listBoards = args => {
    const scene = getScene()
    const query = text(args.text).toLowerCase()
    const requested = args.uids ? new Set(args.uids) : null
    const boards = scene.boards.filter(board => {
      if (requested && !requested.has(board.uid)) return false
      if (args.newShotOnly && !board.newShot) return false
      if (query && ![board.action, board.dialogue, board.notes, board.shot].some(value => text(value).toLowerCase().includes(query))) return false
      return true
    }).map(board => args.includeShotGenerator ? boardSummary(board, scene) : {
      ...boardSummary(board, scene),
      shotGenerator: undefined
    })
    return { ok: true, revision: ctx.getRevision(), boards }
  }

  const getBoardData = uid => ({ ok: true, revision: ctx.getRevision(), board: boardSummary(getBoard(uid), getScene()) })

  const preserveCurrentBoard = uid => {
    if (typeof ctx.setCurrentBoardIndex !== 'function' || uid == null) return
    const scene = ctx.getBoardData()
    const index = scene && Array.isArray(scene.boards) ? scene.boards.findIndex(board => board && board.uid === uid) : -1
    if (index >= 0) ctx.setCurrentBoardIndex(index)
  }

  const getBoardImage = async ({ uid, kind }) => {
    const board = getBoard(uid)
    const filename = mediaKindToFilename(board, kind)
    if (!filename) throw new AdapterError('NOT_FOUND', `Board ${uid} has no ${kind} image`)
    await ctx.saveCurrentImageIfNeeded(board)
    const info = safeFileInfo(ctx, filename)
    if (!info) throw new AdapterError('NOT_FOUND', `Board ${uid} image is missing`)
    return { ok: true, revision: ctx.getRevision(), mimeType: info.mimeType, dataBase64: info.dataBase64 }
  }

  const inspectProject = () => {
    const scene = getScene()
    const issues = []
    const seenUids = new Set()
    const seenFiles = new Set()
    const add = (code, message, uid) => issues.push({ code, message, ...(uid ? { uid } : {}) })
    for (const board of scene.boards) {
      if (!board.uid || seenUids.has(board.uid)) add('DUPLICATE_UID', 'Board UID is missing or duplicated', board.uid)
      seenUids.add(board.uid)
      if (board.duration != null && (!Number.isFinite(Number(board.duration)) || Number(board.duration) < 0)) add('INVALID_DURATION', 'Board duration is invalid', board.uid)
      const hasContent = Boolean(text(board.action).trim() || text(board.dialogue).trim() || text(board.notes).trim() ||
        (board.layers && Object.keys(board.layers).length) || board.audio || board.sg)
      if (!hasContent) add('EMPTY_BOARD', 'Board has no text, audio, Shot Generator data, or image layers', board.uid)
      for (const filename of boardModel.getMediaFilenames(board)) {
        if (!filename || seenFiles.has(filename)) continue
        seenFiles.add(filename)
        if (!safeReferencedFileExists(ctx, filename)) add('MISSING_MEDIA', `Missing or unreadable media: ${publicMediaFilename(filename) || '[unsafe media filename]'}`, board.uid)
      }
      if (board.audio && board.audio.filename && !safeReferencedFileExists(ctx, board.audio.filename)) add('MISSING_AUDIO', `Missing audio: ${publicMediaFilename(board.audio.filename) || '[unsafe audio filename]'}`, board.uid)
      if (board.sg && (!board.sg.data || !board.sg.data.sceneObjects)) add('INVALID_SHOT_GENERATOR', 'Shot Generator scene data is invalid', board.uid)
    }
    return { ok: true, revision: ctx.getRevision(), valid: issues.length === 0, issueCount: issues.length, issues }
  }

  const getShotList = scope => {
    const result = ctx.getShotList(scope)
    if (!result || typeof result !== 'object') return { ok: true, revision: ctx.getRevision(), shots: [] }
    return own(result, 'revision') ? result : { ...result, revision: ctx.getRevision() }
  }

  const readResource = async uri => {
    if (uri === 'storyboarder://session') return getContext()
    if (uri === 'storyboarder://project/script') return getScript()
    if (uri === 'storyboarder://scene/current') return sceneSummary(getScene(), { revision: ctx.getRevision(), scene: ctx.getCurrentSceneInfo() })
    if (uri === 'storyboarder://project/shot-list') return getShotList('project')
    throw new AdapterError('NOT_FOUND', `Resource ${uri} was not found`)
  }

  const validateBase = args => {
    if (typeof args.baseRevision !== 'number' || args.baseRevision !== ctx.getRevision()) {
      throw new AdapterError('STALE_REVISION', 'The project changed since this request was prepared')
    }
  }

  const validateDraft = (draft, label = 'board draft') => {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new AdapterError('VALIDATION_FAILED', `${label} must be an object`)
    for (const key of Object.keys(draft)) {
      if (!['action', 'dialogue', 'notes', 'durationMs', 'newShot'].includes(key)) {
        throw new AdapterError('VALIDATION_FAILED', `${label} contains unsupported field ${key}`)
      }
    }
    for (const key of ['action', 'dialogue', 'notes']) {
      if (own(draft, key) && typeof draft[key] !== 'string') throw new AdapterError('VALIDATION_FAILED', `${label}.${key} must be a string`)
    }
    if (own(draft, 'durationMs') && (!Number.isInteger(Number(draft.durationMs)) || Number(draft.durationMs) < 0 || Number(draft.durationMs) > 24 * 60 * 60 * 1000)) {
      throw new AdapterError('VALIDATION_FAILED', `${label}.durationMs must be a non-negative integer`) 
    }
    if (own(draft, 'newShot') && typeof draft.newShot !== 'boolean') throw new AdapterError('VALIDATION_FAILED', `${label}.newShot must be a boolean`)
    return draft
  }

  const createMediaBackup = scene => {
    if (!ctx.safeMediaPath || !scene || !Array.isArray(scene.boards)) return null
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-mcp-'))
    const files = new Map()
    try {
      for (const board of scene.boards) {
        for (const filename of boardModel.getMediaFilenames(board)) {
          if (files.has(filename) || typeof filename !== 'string') continue
          const source = ctx.safeMediaPath(filename)
          if (!source || !fs.existsSync(source)) {
            files.set(filename, null)
            continue
          }
          const stat = fs.statSync(source)
          if (!stat.isFile()) {
            files.set(filename, null)
            continue
          }
          const destination = path.join(root, String(files.size))
          fs.copyFileSync(source, destination)
          files.set(filename, destination)
        }
      }
      return { root, files }
    } catch (error) {
      try { fs.removeSync(root) } catch (err) {}
      throw new AdapterError('INTERNAL_ERROR', `Could not prepare a media rollback: ${error.message}`)
    }
  }

  const restoreMediaBackup = (backup, sceneAfter) => {
    if (!backup || !ctx.safeMediaPath) return
    const after = new Set()
    for (const board of (sceneAfter && sceneAfter.boards) || []) {
      for (const filename of boardModel.getMediaFilenames(board)) if (typeof filename === 'string') after.add(filename)
    }
    for (const filename of after) {
      if (backup.files.has(filename)) continue
      const destination = ctx.safeMediaPath(filename, { forWrite: true })
      if (destination) {
        try { fs.removeSync(destination) } catch (err) {}
      }
    }
    for (const [filename, source] of backup.files) {
      const destination = ctx.safeMediaPath(filename, { forWrite: true })
      if (!destination) continue
      try {
        if (source && fs.existsSync(source)) fs.copyFileSync(source, destination)
        else fs.removeSync(destination)
      } catch (err) {}
    }
  }

  const cleanupMediaBackup = backup => {
    if (backup && backup.root) {
      try { fs.removeSync(backup.root) } catch (err) {}
    }
  }

  const applyChange = async ({ baseRevision, summary, images, apply }) => {
    if (writeInProgress) throw new AdapterError('BUSY', 'Another MCP change is waiting for approval')
    if (baseRevision !== ctx.getRevision()) throw new AdapterError('STALE_REVISION', 'The project changed since this request was prepared')
    writeInProgress = true
    const before = clone(ctx.getBoardData())
    let mediaBackup
    try {
      mediaBackup = createMediaBackup(before)
      const approval = await showPreview({ baseRevision, ...summary }, images, ctx.getRevision)
      if (approval.status === 'rejected') return { ok: true, status: 'rejected', revision: ctx.getRevision() }
      if (approval.status === 'expired') return { ok: true, status: 'expired', revision: ctx.getRevision() }
      if (approval.status === 'conflict') return { ok: true, status: 'conflict', revision: ctx.getRevision() }
      if (baseRevision !== ctx.getRevision()) return { ok: true, status: 'conflict', revision: ctx.getRevision() }

      await ctx.saveImageFile()
      if (baseRevision !== ctx.getRevision()) return { ok: true, status: 'conflict', revision: ctx.getRevision() }
      ctx.storeUndoStateForScene(true)
      const result = await apply()
      ctx.updateSceneTiming()
      ctx.markBoardFileDirty()
      ctx.renderThumbnailDrawer()
      ctx.renderMetaData()
      await ctx.saveImageFile()
      ctx.saveBoardFile({ force: true })
      ctx.storeUndoStateForScene()
      await ctx.refreshAfterMcpChange()
      ctx.notifyChanged()
      return { ok: true, status: 'applied', revision: ctx.getRevision(), ...result }
    } catch (error) {
      const failedScene = ctx.getBoardData()
      ctx.setBoardData(before)
      restoreMediaBackup(mediaBackup, failedScene)
      try { await ctx.refreshAfterMcpChange() } catch (err) {}
      throw asError(error)
    } finally {
      cleanupMediaBackup(mediaBackup)
      writeInProgress = false
    }
  }

  const proposeDraft = async args => {
    validateBase(args)
    const scene = getScene()
    if (!Array.isArray(args.boards) || args.boards.length < 1 || args.boards.length > 1000) throw new AdapterError('VALIDATION_FAILED', 'boards must contain between 1 and 1000 drafts')
    args.boards.forEach((draft, index) => validateDraft(draft, `boards[${index}]`))
    const insertAfter = args.insertAfterUid == null ? ctx.getCurrentBoardIndex() : scene.boards.findIndex(board => board.uid === args.insertAfterUid)
    if (args.insertAfterUid != null && insertAfter < 0) throw new AdapterError('NOT_FOUND', `Board ${args.insertAfterUid} was not found`)
    const position = insertAfter + 1
    return applyChange({
      baseRevision: args.baseRevision,
      summary: { operation: 'insert boards', reason: clampText(args.reason), scene: ctx.getCurrentSceneInfo(), insertAt: position, boards: args.boards },
      apply: async () => {
        const currentUid = scene.boards[ctx.getCurrentBoardIndex()] && scene.boards[ctx.getCurrentBoardIndex()].uid
        const uids = []
        for (let index = 0; index < args.boards.length; index++) {
          const draft = args.boards[index]
          const board = ctx.insertNewBoardDataAtPosition(position + index)
          if (own(draft, 'action')) board.action = clampText(draft.action)
          if (own(draft, 'dialogue')) board.dialogue = clampText(draft.dialogue)
          if (own(draft, 'notes')) board.notes = clampText(draft.notes)
          if (own(draft, 'durationMs')) board.duration = Number(draft.durationMs)
          if (own(draft, 'newShot')) board.newShot = Boolean(draft.newShot)
          await ctx.savePosterFrame(board, true, true)
          await ctx.saveThumbnailFile(position + index, { forceReadFromFiles: true, blank: true })
          uids.push(board.uid)
        }
        preserveCurrentBoard(currentUid)
        return { affectedBoardUids: uids }
      }
    })
  }

  const proposeUpdates = async args => {
    validateBase(args)
    const scene = getScene()
    if (!Array.isArray(args.updates) || args.updates.length < 1 || args.updates.length > 1000) throw new AdapterError('VALIDATION_FAILED', 'updates must contain between 1 and 1000 items')
    const updates = args.updates.map(update => {
      if (!update || typeof update !== 'object' || typeof update.uid !== 'string' || !update.set || typeof update.set !== 'object') throw new AdapterError('VALIDATION_FAILED', 'Each update requires a uid and set object')
      validateDraft(update.set, `update ${update.uid}`)
      const board = scene.boards.find(item => item.uid === update.uid)
      if (!board) throw new AdapterError('NOT_FOUND', `Board ${update.uid} was not found`)
      return update
    })
    const previewUpdates = updates.map(update => {
      const board = scene.boards.find(item => item.uid === update.uid)
      const before = {}
      for (const key of ['action', 'dialogue', 'notes', 'duration', 'newShot']) if (own(board, key)) before[key] = board[key]
      return { uid: update.uid, before, after: update.set }
    })
    return applyChange({
      baseRevision: args.baseRevision,
      summary: { operation: 'update boards', reason: clampText(args.reason), updates: previewUpdates },
      apply: async () => {
        for (const update of updates) {
          const board = getBoard(update.uid)
          for (const key of ['action', 'dialogue', 'notes']) if (own(update.set, key)) board[key] = clampText(update.set[key])
          if (own(update.set, 'durationMs')) board.duration = Number(update.set.durationMs)
          if (own(update.set, 'newShot')) board.newShot = Boolean(update.set.newShot)
        }
        return { affectedBoardUids: updates.map(update => update.uid) }
      }
    })
  }

  const proposeReorder = async args => {
    validateBase(args)
    const scene = getScene()
    const current = scene.boards.map(board => board.uid)
    const requested = args.orderedBoardUids
    if (!Array.isArray(requested)) throw new AdapterError('VALIDATION_FAILED', 'orderedBoardUids must be an array')
    if (requested.length !== current.length || new Set(requested).size !== requested.length || requested.some(uid => !current.includes(uid))) {
      throw new AdapterError('VALIDATION_FAILED', 'orderedBoardUids must contain every current board exactly once')
    }
    return applyChange({
      baseRevision: args.baseRevision,
      summary: { operation: 'reorder boards', reason: clampText(args.reason), before: current, after: requested },
      apply: async () => {
        const currentUid = scene.boards[ctx.getCurrentBoardIndex()] && scene.boards[ctx.getCurrentBoardIndex()].uid
        const byUid = new Map(scene.boards.map(board => [board.uid, board]))
        scene.boards.splice(0, scene.boards.length, ...requested.map(uid => byUid.get(uid)))
        preserveCurrentBoard(currentUid)
        return { affectedBoardUids: requested }
      }
    })
  }

  const proposeDelete = async args => {
    validateBase(args)
    const scene = getScene()
    if (!Array.isArray(args.boardUids) || args.boardUids.length < 1) throw new AdapterError('VALIDATION_FAILED', 'boardUids must contain at least one board')
    const requested = Array.from(new Set(args.boardUids))
    if (requested.length >= scene.boards.length) throw new AdapterError('VALIDATION_FAILED', 'At least one board must remain')
    if (requested.some(uid => !scene.boards.some(board => board.uid === uid))) throw new AdapterError('NOT_FOUND', 'One or more boards were not found')
    const deleted = scene.boards.filter(board => requested.includes(board.uid)).map(board => boardSummary(board, scene))
    return applyChange({
      baseRevision: args.baseRevision,
      summary: { operation: 'delete boards', reason: clampText(args.reason), boards: deleted, remainingBoardCount: scene.boards.length - requested.length },
      apply: async () => {
        const currentUid = scene.boards[ctx.getCurrentBoardIndex()] && scene.boards[ctx.getCurrentBoardIndex()].uid
        scene.boards = scene.boards.filter(board => !requested.includes(board.uid))
        ctx.setBoardData(scene)
        if (requested.includes(currentUid)) {
          if (typeof ctx.setCurrentBoardIndex === 'function') ctx.setCurrentBoardIndex(Math.min(ctx.getCurrentBoardIndex(), scene.boards.length - 1))
        } else {
          preserveCurrentBoard(currentUid)
        }
        return { affectedBoardUids: requested }
      }
    })
  }

  const proposeImageImport = async args => {
    validateBase(args)
    const scene = getScene()
    if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 50) throw new AdapterError('VALIDATION_FAILED', 'items must contain between 1 and 50 images')
    const prepared = args.items.map(item => {
      if (!item || typeof item !== 'object' || !item.target || typeof item.target !== 'object') throw new AdapterError('VALIDATION_FAILED', 'Each image item requires a target')
      const source = dataUrlFromSource(item.source)
      const target = item.target
      if (target.boardUid != null && (own(target, 'insertAfterUid') || own(target, 'board'))) throw new AdapterError('VALIDATION_FAILED', 'An image target cannot specify both an existing board and a new board')
      if (target.boardUid == null && target.insertAfterUid != null && typeof target.insertAfterUid !== 'string') throw new AdapterError('VALIDATION_FAILED', 'insertAfterUid must be a string or null')
      if (target.boardUid == null && target.insertAfterUid != null && scene.boards.findIndex(board => board.uid === target.insertAfterUid) < 0) throw new AdapterError('NOT_FOUND', `Board ${target.insertAfterUid} was not found`)
      if (target.boardUid != null && typeof target.boardUid !== 'string') throw new AdapterError('VALIDATION_FAILED', 'boardUid must be a string')
      if (target.layer != null && !ALLOWED_LAYERS.has(target.layer)) throw new AdapterError('VALIDATION_FAILED', `Unsupported image layer ${target.layer}`)
      if (target.board) validateDraft(target.board, 'target.board')
      return { ...item, source }
    })
    const images = prepared.map((item, index) => ({ label: `Image ${index + 1}`, dataUrl: item.source.dataUrl }))
    return applyChange({
      baseRevision: args.baseRevision,
      summary: { operation: 'import images', reason: clampText(args.reason), itemCount: prepared.length, targets: prepared.map(item => item.target) },
      images,
      apply: async () => {
        const affectedBoardUids = []
        const currentUid = scene.boards[ctx.getCurrentBoardIndex()] && scene.boards[ctx.getCurrentBoardIndex()].uid
        for (const item of prepared) {
          const target = item.target
          let board
          let index
          if (target.boardUid) {
            board = getBoard(target.boardUid)
            index = scene.boards.indexOf(board)
          } else {
            const insertAfter = target.insertAfterUid == null ? ctx.getCurrentBoardIndex() : scene.boards.findIndex(candidate => candidate.uid === target.insertAfterUid)
            if (target.insertAfterUid != null && insertAfter < 0) throw new AdapterError('NOT_FOUND', `Board ${target.insertAfterUid} was not found`)
            index = insertAfter + 1
            board = ctx.insertNewBoardDataAtPosition(index)
            if (target.board) {
              for (const key of ['action', 'dialogue', 'notes']) if (own(target.board, key)) board[key] = clampText(target.board[key])
              if (own(target.board, 'durationMs')) board.duration = Number(target.board.durationMs)
              if (own(target.board, 'newShot')) board.newShot = Boolean(target.board.newShot)
            }
          }
          let image
          try {
            image = await ctx.fitImageData([ctx.getCanvasSize().width, ctx.getCanvasSize().height], item.source.dataUrl, { forcePng: true })
          } catch (error) {
            throw new AdapterError('VALIDATION_FAILED', 'Image could not be decoded')
          }
          const layerName = target.layer || 'reference'
          if (!ALLOWED_LAYERS.has(layerName)) throw new AdapterError('VALIDATION_FAILED', `Unsupported image layer ${layerName}`)
          if (!publicMediaFilename(board.url) || path.extname(board.url).toLowerCase() !== '.png') throw new AdapterError('VALIDATION_FAILED', 'Board has an unsafe image filename')
          const filename = boardModel.boardFilenameForLayer(board, layerName)
          board.layers = board.layers || {}
          board.layers[layerName] = { ...(board.layers[layerName] || {}), url: filename }
          if (layerName === 'reference') board.layers[layerName].opacity = 1
          if (!ctx.saveDataURLtoFile(image, filename)) throw new AdapterError('VALIDATION_FAILED', 'Could not save the imported image')
          await ctx.savePosterFrame(board, true)
          await ctx.saveThumbnailFile(index, { forceReadFromFiles: true })
          affectedBoardUids.push(board.uid)
        }
        preserveCurrentBoard(currentUid)
        return { affectedBoardUids }
      }
    })
  }

  const exportProject = async args => {
    validateBase(args)
    const format = args.format
    if (!ALLOWED_EXPORT_FORMATS.has(format)) throw new AdapterError('VALIDATION_FAILED', `Export format ${format} is not supported`)
    const scene = getScene()
    return applyChange({
      baseRevision: args.baseRevision,
      summary: { operation: 'export project', reason: clampText(args.reason), format, boardCount: scene.boards.length },
      apply: async () => {
        await ctx.saveImageFile()
        let outputPath
        if (format === 'images') outputPath = await ctx.exporter.exportImages(scene, ctx.getBoardFilename())
        else if (format === 'fcpxml') outputPath = await ctx.exporter.exportFcp(scene, ctx.getBoardFilename())
        else if (format === 'gif') outputPath = await ctx.exporter.exportAnimatedGif(clone(scene.boards), ctx.getCanvasSize(), 888, ctx.getBoardFilename(), ctx.shouldWatermark(), scene, ctx.getWatermarkPath())
        else if (format === 'video') outputPath = await ctx.exporter.exportVideo(scene, ctx.getBoardFilename(), { shouldWatermark: ctx.shouldWatermark(), watermarkImagePath: ctx.getWatermarkPath(), progressCallback: () => {} })
        else if (format === 'zip' && typeof ctx.exportZip === 'function') return { ...(await ctx.exportZip()), format }
        else if (format === 'pdf' && typeof ctx.exportPdf === 'function') return { ...(await ctx.exportPdf()), format }
        else throw new AdapterError('VALIDATION_FAILED', `Export format ${format} is not available in the current print bridge`)
        if (!outputPath || typeof outputPath !== 'string') throw new AdapterError('INTERNAL_ERROR', 'Exporter did not return an output file')
        const relativeOutputPath = path.relative(ctx.getProjectRoot(), outputPath)
        if (!relativeOutputPath || relativeOutputPath.startsWith('..') || path.isAbsolute(relativeOutputPath)) throw new AdapterError('INTERNAL_ERROR', 'Exporter returned an unsafe output path')
        return { format, outputPath: relativeOutputPath.replace(/\\/g, '/') }
      }
    })
  }

  const handle = async (operation, args = {}) => {
    switch (operation) {
      case 'get-context': return getContext()
      case 'read-resource': return readResource(args.uri)
      case 'list-scenes': return listScenes(args.includeCompleted !== false)
      case 'list-boards': return listBoards(args)
      case 'get-board': return getBoardData(args.uid)
      case 'get-board-image': return getBoardImage(args)
      case 'inspect-project': return inspectProject()
      case 'get-shot-list': return getShotList(args.scope || 'scene')
      case 'focus': return ctx.focus(args)
      case 'propose-board-draft': return proposeDraft(args)
      case 'propose-board-updates': return proposeUpdates(args)
      case 'propose-reorder': return proposeReorder(args)
      case 'propose-delete': return proposeDelete(args)
      case 'propose-image-import': return proposeImageImport(args)
      case 'export': return exportProject(args)
      default: throw new AdapterError('VALIDATION_FAILED', `Unsupported MCP operation ${operation}`)
    }
  }

  return { handle }
}

module.exports = {
  AdapterError,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_LAYERS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  dataUrlFromSource,
  imageDimensions,
  createMcpAdapter
}
