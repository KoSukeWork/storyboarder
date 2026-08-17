const path = require('./path-shim')
const fs = require('./fs-shim')
let counter = 0
const nextPath = () => path.join(window.storyboarderMain.app.getPath('temp'), 'storyboarder-renderer', `storyboarder-tmp-${Date.now()}-${++counter}`)
module.exports = {
  dirSync: options => { const name = nextPath(); fs.ensureDirSync(name); return { name, removeCallback: () => { if (fs.existsSync(name)) fs.unlinkSync(name) } } },
  fileSync: options => { const name = nextPath(); fs.ensureFileSync(name); return { name, removeCallback: () => { if (fs.existsSync(name)) fs.unlinkSync(name) } } }
}
