const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const uniqueSortedNumbers = values => [...new Set(
  values
    .filter(value => Number.isFinite(value))
    .map(value => Math.round(value))
)].sort((a, b) => a - b)

const sceneHasAudio = scene => !!(
  scene &&
  Array.isArray(scene.boards) &&
  scene.boards.some(board =>
    board &&
    board.audio &&
    typeof board.audio.filename === 'string' &&
    board.audio.filename.length > 0
  )
)

const sceneBoundaryTimes = (scene, sceneDuration) => uniqueSortedNumbers([
  ...(scene && Array.isArray(scene.boards) ? scene.boards.map(board => board.time) : []),
  sceneDuration
])

// The playback duration may be extended by an audio clip, but that extension
// is not a board insertion boundary. Keep the visual board timeline duration
// separate so a cursor in an audio tail inserts after the last board instead
// of snapping back to that board's start.
const boardTimelineDuration = (scene, getBoardDuration) => {
  if (!scene || !Array.isArray(scene.boards)) return 0

  let end = 0
  for (let board of scene.boards) {
    let start = Number(board && board.time)
    let duration = typeof getBoardDuration === 'function'
      ? Number(getBoardDuration(board))
      : Number(board && board.duration)

    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue
    end = Math.max(end, start + Math.max(0, duration))
  }

  return Math.round(end)
}

// Electron's renderer PointerEvent exposes `x` in some paths while browser
// PointerEvents expose `clientX`. Keep the compatibility handling in one
// place so an event with neither coordinate cannot accidentally reset the
// current cursor to the start of the scene.
const pointerXFromEvent = event => {
  if (!event || typeof event !== 'object') return undefined

  if (Number.isFinite(event.clientX)) return event.clientX
  if (Number.isFinite(event.x)) return event.x

  return undefined
}

const snapTimeToBoundary = (time, boundaries) => {
  let sorted = uniqueSortedNumbers(boundaries)
  if (sorted.length === 0) return Math.round(time)

  let closest = sorted[0]
  for (let boundary of sorted.slice(1)) {
    // <= intentionally chooses the later boundary on an exact tie.
    if (Math.abs(boundary - time) <= Math.abs(closest - time)) closest = boundary
  }
  return closest
}

const cursorTimeFromPointer = ({
  clientX,
  event,
  rectLeft,
  scrollLeft = 0,
  pixelsPerMsec,
  scale = 1,
  sceneDuration,
  snap = false,
  boundaries = []
}) => {
  let pointerX = Number.isFinite(clientX) ? clientX : pointerXFromEvent(event)
  if (!Number.isFinite(pointerX) || !Number.isFinite(rectLeft) ||
      !Number.isFinite(pixelsPerMsec) || pixelsPerMsec <= 0 ||
      !Number.isFinite(scale) || scale <= 0) return undefined

  let rawTime = ((pointerX - rectLeft + scrollLeft) / (pixelsPerMsec * scale))
  let time = clamp(rawTime, 0, Math.max(0, sceneDuration || 0))
  return snap ? snapTimeToBoundary(time, boundaries) : Math.round(time)
}

const boardIndexAtTime = (boards, time) => {
  if (!Array.isArray(boards) || boards.length === 0) return -1

  let index = 0
  for (let i = 0; i < boards.length; i++) {
    if (boards[i].time > time) break
    index = i
  }
  return index
}

const insertionIndexAtTime = (boards, time) => {
  if (!Array.isArray(boards) || boards.length === 0) return 0

  let index = boards.findIndex(board => board.time >= time)
  return index === -1 ? boards.length : index
}

// Split a board at an exact cursor time. Do not snap to board boundaries:
// a snapped time would always land on a start/end and never split.
const splitBoardAtTime = (boards, time, { getDuration, minDuration } = {}) => {
  if (!Array.isArray(boards) || boards.length === 0) return null
  if (!Number.isFinite(time)) return null

  let min = Number.isFinite(minDuration) && minDuration > 0 ? Math.round(minDuration) : 1
  let index = boardIndexAtTime(boards, time)
  if (index < 0) return null

  let board = boards[index]
  let start = Number(board && board.time)
  if (!Number.isFinite(start)) return null

  let duration = typeof getDuration === 'function'
    ? Number(getDuration(board, index))
    : Number(board && board.duration)
  if (!Number.isFinite(duration) || duration <= 0) return null

  let firstDuration = Math.round(time - start)
  let secondDuration = Math.round(duration - firstDuration)
  if (firstDuration < min || secondDuration < min) return null

  return { index, firstDuration, secondDuration }
}

module.exports = {
  sceneHasAudio,
  sceneBoundaryTimes,
  boardTimelineDuration,
  pointerXFromEvent,
  snapTimeToBoundary,
  cursorTimeFromPointer,
  boardIndexAtTime,
  insertionIndexAtTime,
  splitBoardAtTime
}
