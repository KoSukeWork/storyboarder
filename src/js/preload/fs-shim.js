const bridge = window.storyboarderMain
const BufferCtor = typeof Buffer !== 'undefined' ? Buffer : require('buffer').Buffer
const call = request => {
  const result = bridge._internal.fs(request)
  if (result && result.__storyboarderError === true) {
    const error = new Error(typeof result.message === 'string' ? result.message : 'File operation failed')
    error.code = typeof result.code === 'string' ? result.code : 'EIO'
    throw error
  }
  // A synchronous IPC handler that fails without returning a value must not
  // turn into a misleading `undefined.isFile()` TypeError in renderer code.
  if (result === undefined && request && ['stat', 'lstat', 'realpath', 'read'].includes(request.op)) {
    const error = new Error('File operation failed')
    error.code = 'EIO'
    throw error
  }
  return result
}
const decode = value => {
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) return BufferCtor.from(value.data)
  if (value instanceof Uint8Array || Array.isArray(value)) return BufferCtor.from(value)
  return value
}
const stat = value => value && { ...value, isFile: () => Boolean(value.file), isDirectory: () => Boolean(value.directory), isSymbolicLink: () => Boolean(value.symbolicLink) }
const fs = {
  existsSync: filePath => Boolean(call({ op: 'exists', path: filePath })),
  statSync: filePath => stat(call({ op: 'stat', path: filePath })),
  lstatSync: filePath => stat(call({ op: 'lstat', path: filePath })),
  realpathSync: filePath => call({ op: 'realpath', path: filePath }),
  readdirSync: filePath => call({ op: 'readdir', path: filePath }),
  mkdirSync: (filePath, options) => call({ op: 'mkdir', path: filePath, options }),
  ensureDirSync: filePath => call({ op: 'mkdir', path: filePath, options: { recursive: true } }),
  ensureFileSync: filePath => { if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, BufferCtor.alloc(0)); return filePath },
  emptyDirSync: filePath => call({ op: 'emptyDir', path: filePath }),
  readFileSync: (filePath, options) => {
    const result = decode(call({ op: 'read', path: filePath }))
    if (options === 'base64' || options && options.encoding === 'base64') return BufferCtor.from(result).toString('base64')
    if (options === 'utf8' || options && options.encoding) return BufferCtor.from(result).toString(options.encoding || 'utf8')
    return result
  },
  writeFileSync: (filePath, data, options) => {
    let value = data
    let encoding = typeof options === 'string' ? options : options && options.encoding
    if (encoding === 'base64') value = BufferCtor.from(String(data), 'base64')
    else if (typeof data === 'string') value = BufferCtor.from(data, encoding || 'utf8')
    return call({ op: 'write', path: filePath, data: value, options })
  },
  readFile: (filePath, options, callback) => {
    if (typeof options === 'function') { callback = options; options = undefined }
    try { callback(null, fs.readFileSync(filePath, options)) } catch (error) { callback(error) }
  },
  writeFile: (filePath, data, options, callback) => {
    if (typeof options === 'function') { callback = options; options = undefined }
    try { fs.writeFileSync(filePath, data, options); if (callback) callback(null) } catch (error) { if (callback) callback(error); else throw error }
  },
  copySync: (from, to, options) => call({ op: 'copy', from, to, options }),
  moveSync: (from, to, options) => call({ op: 'move', from, to, options }),
  renameSync: (from, to) => call({ op: 'move', from, to }),
  unlinkSync: filePath => call({ op: 'remove', path: filePath }),
  createReadStream: filePath => createStream('read', filePath),
  createWriteStream: filePath => createStream('write', filePath)
}
const createStream = (mode, filePath) => {
  const EventEmitter = require('./events-shim')
  const stream = new EventEmitter()
  stream._chunks = []
  stream.write = chunk => { stream._chunks.push(chunk); return true }
  stream.end = chunk => { if (chunk) stream.write(chunk); if (mode === 'write') fs.writeFileSync(filePath, BufferCtor.concat(stream._chunks.map(value => BufferCtor.from(value)))); stream.emit('finish'); stream.emit('close'); return stream }
  stream.pipe = destination => { destination.write(fs.readFileSync(filePath)); destination.end(); return destination }
  return stream
}
module.exports = fs
