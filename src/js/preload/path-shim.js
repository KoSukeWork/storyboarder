const normalizeSeparators = value => String(value).replace(/\\/g, '/')
const isWin = typeof process !== 'undefined' && process.platform === 'win32'
const separator = isWin ? '\\' : '/'
const splitRoot = input => {
  const value = normalizeSeparators(input)
  const match = value.match(/^(?:([A-Za-z]:\/)|\/\/[^/]+\/[^/]+\/?|\/)/)
  return { root: match ? match[0] : '', rest: match ? value.slice(match[0].length) : value }
}
const normalize = input => {
  const { root, rest } = splitRoot(input)
  const parts = []
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (parts.length && parts[parts.length - 1] !== '..') parts.pop(); else if (!root) parts.push(part) }
    else parts.push(part)
  }
  const result = `${root}${parts.join('/')}` || (root || '.')
  return isWin ? result.replace(/\//g, '\\') : result
}
const resolve = (...args) => {
  let resolved = ''
  for (let index = args.length - 1; index >= -1 && !splitRoot(resolved).root; index--) {
    const value = index < 0 ? '.' : args[index]
    if (value != null && String(value)) resolved = `${value}/${resolved}`
  }
  return normalize(resolved)
}
const dirname = value => {
  const normalized = normalizeSeparators(value).replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  if (index < 0) return '.'
  if (index === 0) return '/'
  return normalized.slice(0, index).replace(/\//g, separator)
}
const basename = (value, suffix) => {
  const normalized = normalizeSeparators(value).replace(/\/+$/, '')
  let result = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (suffix && result.endsWith(suffix)) result = result.slice(0, -suffix.length)
  return result
}
const extname = value => {
  const name = basename(value)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}
const join = (...args) => normalize(args.filter(value => value !== '').join('/'))
const relative = (from, to) => {
  const a = normalizeSeparators(resolve(from)).split('/').filter(Boolean)
  const b = normalizeSeparators(resolve(to)).split('/').filter(Boolean)
  let index = 0
  while (index < a.length && index < b.length && a[index].toLowerCase() === b[index].toLowerCase()) index++
  return [...Array(a.length - index).fill('..'), ...b.slice(index)].join(separator)
}
const isAbsolute = value => {
  const normalized = normalizeSeparators(value)
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
}
module.exports = { sep: separator, delimiter: isWin ? ';' : ':', normalize, resolve, dirname, basename, extname, join, relative, isAbsolute, parse: value => ({ root: splitRoot(value).root, dir: dirname(value), base: basename(value), ext: extname(value), name: basename(value, extname(value)) }), win32: { isAbsolute: value => /^[A-Za-z]:[\\/]|^\\\\/.test(String(value)) } }
