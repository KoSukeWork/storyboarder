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
  rectLeft,
  scrollLeft = 0,
  pixelsPerMsec,
  scale = 1,
  sceneDuration,
  snap = false,
  boundaries = []
}) => {
  if (!Number.isFinite(pixelsPerMsec) || pixelsPerMsec <= 0 || !Number.isFinite(scale) || scale <= 0) {
    return 0
  }

  let rawTime = ((clientX - rectLeft + scrollLeft) / (pixelsPerMsec * scale))
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

module.exports = {
  sceneHasAudio,
  sceneBoundaryTimes,
  snapTimeToBoundary,
  cursorTimeFromPointer,
  boardIndexAtTime,
  insertionIndexAtTime
}
