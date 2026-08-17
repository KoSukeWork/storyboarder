const path = require('path')
const util = require('../utils/index')

const boardFileImageSize = boardFileData =>
  (boardFileData.aspectRatio >= 1)
    ? [900 * boardFileData.aspectRatio, 900]
    : [900, 900 / boardFileData.aspectRatio]

const boardFilenameForExport = (board, index, basenameWithoutExt) =>
  `${basenameWithoutExt}-board-` + util.zeroFill(5, index + 1) + '.png'

const boardUrl = board => board && typeof board.url === 'string' ? board.url : ''

const boardFilenameForThumbnail = board =>
  boardUrl(board).replace('.png', '-thumbnail.png')

const boardFilenameForLink = board =>
  boardUrl(board).replace('.png', '.psd')
  // alternatively, could calculate link filename from url filename, preserving link extension:
  // return path.basename(board.url, path.extname(board.url)) + path.extname(board.link)

const boardFilenameForLayer = (board, layerKey) =>
  boardUrl(board).replace('.png', `-${layerKey}.png`)

// used for shot-generator
const boardFilenameForLayerThumbnail = (board, layerName) =>
  boardUrl(board).replace('.png', `-${layerName}-thumbnail.jpg`)

const boardFilenameForPosterFrame = (board) =>
  boardUrl(board).replace('.png', `-posterframe.jpg`)

const boardFilenameForCameraPlot = (board) =>
  boardUrl(board).replace('.png', `-camera-plot.png`)

// TODO review usage
// array of fixed size, ordered positions
const boardOrderedLayerFilenames = board => {
  let indices = []
  let filenames = []

  if (!board || typeof board !== 'object' || Array.isArray(board)) return { indices, filenames }

  // HACK hardcoded
  // see StoryboarderSketchPane#visibleLayersIndices
  for (let [index, name] of [
    [0, 'reference'],
    [1, 'fill'],
    [2, 'tone'],
    [3, 'pencil'],
    [4, 'ink'],
    // 5 = onion
    [6, 'notes']
    // 7 = guides
    // 8 = composite
  ]) {
    if (board.layers && board.layers[name]) {
      indices.push(index)
      filenames.push(board.layers[name].url)
    }
  }
  
  return { indices, filenames }
}

// board.duration can be a float or undefined
// if undefined, use default board timing (defined for scene)
//
// main-window migrateStringDurations now ensures durations are floats
// when a .storyboarder file is loaded, so
// TODO we *might* not need to convert here via Number() anymore?
const boardDuration = (scene, board) =>
  !isNaN(board.duration)
    ? board.duration
    : scene.defaultBoardTiming

const boardDurationWithAudio = (scene, board) =>
  Math.max(
    board.audio && board.audio.duration ? board.audio.duration : 0,
    boardDuration(scene, board)
  )

const assignUid = board => {
  board.uid = util.uidGen(5)
  return board
}

const setup = board => {
  board.layers = board.layers || {} // TODO is this necessary?

  // set some basic data for the new board
  board.newShot = board.newShot || false
  board.lastEdited = Date.now()

  return board
}

const updateUrlsFromIndex = (board, index) => {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return board
  if (!board.layers || typeof board.layers !== 'object' || Array.isArray(board.layers)) board.layers = {}
  // TODO base on board number instead of external index information
  board.url = 'board-' + (index + 1) + '-' + board.uid + '.png'

  for (let name of Object.keys(board.layers)) {
    board.layers[name].url = boardFilenameForLayer(board, name)
  }

  return board
}

const getMediaDescription = board => {
  board = board && typeof board === 'object' && !Array.isArray(board) ? board : {}
  return {
    // does board layers exist and is it not an empty object?
    layers: (board.layers && Object.keys(board.layers).length)
      // return all the layer filenames
      ? Object.entries(board.layers).reduce((coll, [name, layer]) => {
        return {
          ...coll,
          [name]: layer && typeof layer.url === 'string' ? layer.url : undefined
        }
      }, {})
      : {},
    thumbnail: boardFilenameForThumbnail(board),
    posterframe: boardFilenameForPosterFrame(board),
    link: typeof board.link === 'string' ? board.link : undefined,
    audio: board.audio && typeof board.audio.filename === 'string' ? board.audio.filename : undefined,
    layerThumbnails: (board.layers && Object.keys(board.layers).length)
      // return all the layer thumbnails
      ? Object.entries(board.layers).reduce((coll, [name, layer]) => {
        return {
          ...coll,
          [name]: layer && typeof layer.thumbnail === 'string' ? layer.thumbnail : undefined
        }
      }, {})
      : {},
    ...(board.sg ? { sg: { plot: boardFilenameForCameraPlot(board) } } : {})
  }
}

const getMediaFilenames = board => {
  let media = getMediaDescription(board)
  return [
    ...Object.values(media.layers),
    media.thumbnail,
    media.posterframe,
    media.link,
    media.audio,
    ...Object.values(media.layerThumbnails),
    ...media.sg ? Object.values(media.sg) : []
  ].reduce((coll, value) => {
    if (value) coll.push(value)
    return coll
  }, [])
}

module.exports = {
  boardFileImageSize,
  boardFilenameForExport,
  boardFilenameForThumbnail,
  boardFilenameForLink,
  boardFilenameForLayer,
  boardFilenameForLayerThumbnail,
  boardFilenameForPosterFrame,
  boardFilenameForCameraPlot,
  boardOrderedLayerFilenames,
  boardDuration,
  boardDurationWithAudio,

  assignUid,
  setup,
  updateUrlsFromIndex,

  getMediaDescription,
  getMediaFilenames
}
