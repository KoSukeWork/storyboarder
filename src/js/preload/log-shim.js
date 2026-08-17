const noop = () => {}
module.exports = {
  initialize: noop,
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  log: noop,
  errorHandler: { startCatching: noop },
  transports: { file: { getFile: () => ({ path: '' }) } }
}
