const EventEmitter = require('./events-shim')
class Stream extends EventEmitter {
  pipe (destination) { this.on('data', chunk => destination.write(chunk)); this.on('end', () => destination.end()); return destination }
  write () { return true }
  end () { this.emit('finish'); this.emit('end') }
}
class PassThrough extends Stream {}
module.exports = { Stream, Readable: Stream, Writable: Stream, Transform: Stream, PassThrough }
