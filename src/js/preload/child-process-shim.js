const EventEmitter = require('./events-shim')

const spawn = (command, args = [], options = {}) => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdout.readable = true
  child.stderr.readable = true
  child.stdout.destroy = () => {}
  child.stderr.destroy = () => {}
  child.stdin.end = () => {}
  child.kill = () => false
  child.killed = false
  const bridge = window.storyboarderMain
  bridge.ipc.invoke('mainWindow:process', {
    action: 'run',
    command,
    args,
    cwd: options.cwd
  }).then(result => {
    if (result && result.stdout) child.stdout.emit('data', result.stdout)
    if (result && result.stderr) child.stderr.emit('data', result.stderr)
    child.stdout.emit('end')
    child.stderr.emit('end')
    child.emit('exit', Number(result && result.code) || 0, null)
    child.emit('close', Number(result && result.code) || 0, null)
  }).catch(error => child.emit('error', error))
  return child
}

module.exports = {
  spawn,
  execFile: (command, args, callback) => {
    const bridge = window.storyboarderMain
    bridge.ipc.invoke('mainWindow:project', { action: 'open-editor', command, args })
      .then(result => callback && callback(result && result.ok ? null : new Error('Editor could not be opened'), '', result && result.error || ''))
      .catch(error => callback && callback(error, '', error.message))
  }
}
module.exports.execFileSync = () => { throw new Error('Synchronous child process calls are not available in the renderer') }
