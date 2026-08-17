// Renderer-only compatibility adapter.  Production pages use the restricted
// contextBridge implementation; the legacy remote fallback is retained only
// for standalone Electron renderer tests and old tooling that does not load
// the Storyboarder preload.
if (typeof window !== 'undefined' && window.storyboarderMain) {
  module.exports = require('../preload/renderer-remote-shim')
} else {
  module.exports = require('@electron/remote')
}
