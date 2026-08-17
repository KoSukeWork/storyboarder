class EventEmitter {
  constructor () { this._events = Object.create(null) }
  on (name, listener) { (this._events[name] || (this._events[name] = [])).push(listener); return this }
  addListener (name, listener) { return this.on(name, listener) }
  once (name, listener) { const wrapped = (...args) => { this.removeListener(name, wrapped); listener(...args) }; return this.on(name, wrapped) }
  emit (name, ...args) { for (const listener of (this._events[name] || []).slice()) listener(...args); return (this._events[name] || []).length > 0 }
  removeListener (name, listener) { this._events[name] = (this._events[name] || []).filter(item => item !== listener); return this }
  off (name, listener) { return this.removeListener(name, listener) }
  removeAllListeners (name) { if (name) delete this._events[name]; else this._events = Object.create(null); return this }
}
module.exports = EventEmitter
module.exports.EventEmitter = EventEmitter
