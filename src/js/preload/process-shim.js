const processShim = {
  type: 'renderer',
  platform: (window.storyboarderMain && window.storyboarderMain._internal.process.platform) || 'win32',
  env: { NODE_ENV: 'production' },
  versions: { electron: '0.0.0' },
  version: 'v20.0.0',
  cwd: () => '.',
  nextTick: callback => Promise.resolve().then(callback)
}

// Tone and the storyboard playback clock use Node's monotonic high-resolution
// timer.  Renderer isolation removes Node's process object, so provide the
// small compatible surface they need without exposing any native API.
const monotonicMilliseconds = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

const nowNanoseconds = () => BigInt(Math.floor(monotonicMilliseconds() * 1e6))

const hrtime = previous => {
  const current = nowNanoseconds()
  let seconds = current / 1000000000n
  let nanoseconds = current % 1000000000n
  if (Array.isArray(previous) && previous.length >= 2) {
    const previousNanoseconds = BigInt(Math.max(0, Number(previous[1]) || 0)) +
      BigInt(Math.max(0, Number(previous[0]) || 0)) * 1000000000n
    const elapsed = current - previousNanoseconds
    seconds = elapsed / 1000000000n
    nanoseconds = elapsed % 1000000000n
  }
  return [Number(seconds), Number(nanoseconds)]
}

hrtime.bigint = nowNanoseconds
processShim.hrtime = hrtime

export { processShim as process }
export default processShim
