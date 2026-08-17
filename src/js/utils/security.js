const fs = require('fs')
const path = require('path')

const ALLOWED_MARKUP_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 'br'])
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_PROJECT_FILE_SIZE = 50 * 1024 * 1024

const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

// Project and release-note content is untrusted.  This deliberately uses a
// small allow-list instead of trying to remove known-bad attributes/tags.
const sanitizeMarkup = value => {
  if (value == null) return ''
  const input = String(value)

  // This helper is also used by main-process tests and utilities.  In a
  // non-browser context the safe representation is escaped plain text.
  if (typeof document === 'undefined' || !document.createElement) {
    return escapeHtml(input)
  }

  const template = document.createElement('template')
  template.innerHTML = input

  const sanitizeNode = node => {
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue || '')
    if (node.nodeType !== 1) return document.createDocumentFragment()

    const tagName = node.tagName.toLowerCase()
    if (!ALLOWED_MARKUP_TAGS.has(tagName)) {
      // Keep readable text while dropping the element and all executable
      // attributes.  A script/image/iframe has no useful text to preserve.
      return tagName === 'script' || tagName === 'style' || tagName === 'img' ||
        tagName === 'iframe' || tagName === 'object' || tagName === 'svg'
        ? document.createDocumentFragment()
        : document.createTextNode(node.textContent || '')
    }

    const clean = document.createElement(tagName)
    for (const child of Array.from(node.childNodes)) {
      clean.appendChild(sanitizeNode(child))
    }
    return clean
  }

  const output = document.createElement('div')
  for (const child of Array.from(template.content.childNodes)) {
    output.appendChild(sanitizeNode(child))
  }
  return output.innerHTML
}

const isPathInside = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

const assertSafeRelativePath = candidate => {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('A relative media path is required')
  }
  if (candidate.length > 4096) {
    throw new Error('Media path is too long')
  }
  if (/^[.\\/]+$/.test(candidate)) {
    throw new Error('A media path must reference a file')
  }
  if (candidate.includes('\0')) throw new Error('NUL bytes are not allowed in media paths')
  // Project files can be exchanged between platforms, so reject Windows
  // absolute and drive-relative syntax even when running on POSIX.
  if (
    path.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate) ||
    /^[a-zA-Z]:/.test(candidate) ||
    /^[/\\]{2}/.test(candidate)
  ) {
    throw new Error('Absolute media paths are not allowed')
  }
  if (candidate.split(/[\\/]+/).includes('..')) {
    throw new Error('Path traversal is not allowed')
  }
  return candidate
}

// `realpathSync.native` returns a Windows extended-length (`\\?\\`) path,
// which does not compare correctly with normal paths (and is not emulated by
// mock-fs).  The regular API canonicalizes symlinks while preserving the
// platform's normal path representation.
const realpathOrThrow = filename => fs.realpathSync(filename)
const pathExists = filename => {
  try {
    fs.statSync(filename)
    return true
  } catch (err) {
    return false
  }
}

const assertReadableFile = (filename, maxBytes = MAX_PROJECT_FILE_SIZE) => {
  if (
    typeof filename !== 'string' || filename.length === 0 || filename.length > 4096 ||
    filename.includes('\0') || !path.isAbsolute(filename)
  ) {
    throw new Error('A valid absolute file path is required')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('A valid file size limit is required')
  }

  const lexicalPath = path.resolve(filename)
  const realParent = realpathOrThrow(path.dirname(lexicalPath))
  const realFile = realpathOrThrow(lexicalPath)
  if (!isPathInside(realParent, realFile)) {
    throw new Error('File symlink escapes its parent directory')
  }

  const stat = fs.statSync(realFile)
  if (!stat.isFile()) throw new Error('Expected a regular file')
  if (stat.size > maxBytes) throw new Error(`File exceeds the ${maxBytes} byte size limit`)
  return realFile
}

const readFileUtf8Bounded = (filename, maxBytes = MAX_PROJECT_FILE_SIZE) =>
  fs.readFileSync(assertReadableFile(filename, maxBytes), 'utf8')

// Presets and other user-editable JSON must stay data-only when they are
// merged into application state. The input file is separately size-bounded;
// these limits bound the object graph and remove prototype-pollution keys.
const sanitizeJsonValue = (value, options = {}) => {
  const maxDepth = Number.isSafeInteger(options.maxDepth) ? options.maxDepth : 8
  const maxEntries = Number.isSafeInteger(options.maxEntries) ? options.maxEntries : 50000
  const maxArrayLength = Number.isSafeInteger(options.maxArrayLength) ? options.maxArrayLength : 10000
  const maxStringLength = Number.isSafeInteger(options.maxStringLength) ? options.maxStringLength : 1024 * 1024
  let entriesRemaining = Math.max(0, maxEntries)

  const visit = (item, depth) => {
    if (item == null || typeof item === 'boolean') return item
    if (typeof item === 'number') return Number.isFinite(item) ? item : undefined
    if (typeof item === 'string') return item.length <= maxStringLength ? item : undefined
    if (typeof item !== 'object' || depth > maxDepth || entriesRemaining === 0) return undefined

    if (Array.isArray(item)) {
      const result = []
      for (const child of item.slice(0, Math.max(0, maxArrayLength))) {
        if (entriesRemaining-- <= 0) break
        const sanitized = visit(child, depth + 1)
        if (sanitized !== undefined) result.push(sanitized)
      }
      return result
    }

    const result = {}
    for (const [key, child] of Object.entries(item)) {
      if (entriesRemaining-- <= 0) break
      if (UNSAFE_JSON_KEYS.has(key) || key.length > 1024 || key.includes('\0')) continue
      const sanitized = visit(child, depth + 1)
      if (sanitized !== undefined) result[key] = sanitized
    }
    return result
  }

  return visit(value, 0)
}

// A containment check must also validate the root itself.  If a caller
// passes a symlink as the media directory, resolving only the child path
// would otherwise silently bless a directory outside the project.
const resolveRootInsideParent = root => {
  const lexicalRoot = path.resolve(root)
  const parent = path.dirname(lexicalRoot)
  const realParent = realpathOrThrow(parent)
  const realRoot = realpathOrThrow(lexicalRoot)
  if (!isPathInside(realParent, realRoot)) {
    throw new Error('Media root escapes its parent directory')
  }
  return { lexicalRoot, realRoot }
}

const resolveInside = (root, candidate) => {
  assertSafeRelativePath(candidate)
  const { realRoot } = resolveRootInsideParent(root)
  const resolved = path.resolve(realRoot, candidate)
  if (resolved === realRoot) throw new Error('A media path must reference a file')
  if (!isPathInside(realRoot, resolved)) throw new Error('Path is outside the project')
  const realCandidate = realpathOrThrow(resolved)
  if (!isPathInside(realRoot, realCandidate)) throw new Error('Symlink escapes the project')
  return realCandidate
}

const resolveForWriteInside = (root, candidate) => {
  assertSafeRelativePath(candidate)
  const { realRoot } = resolveRootInsideParent(root)
  const resolved = path.resolve(realRoot, candidate)
  if (resolved === realRoot) throw new Error('A media path must reference a file')
  if (!isPathInside(realRoot, resolved)) throw new Error('Path is outside the project')

  if (pathExists(resolved)) return resolveInside(root, candidate)

  // Resolve the nearest existing parent so a symlinked parent cannot escape
  // the project between validation and the eventual write.
  let parent = path.dirname(resolved)
  while (!pathExists(parent) && parent !== path.dirname(parent)) {
    parent = path.dirname(parent)
  }
  const realParent = realpathOrThrow(parent)
  if (!isPathInside(realRoot, realParent)) throw new Error('Symlink escapes the project')
  return resolved
}

const isSafeExternalUrl = (value, allowedHosts) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    if (allowedHosts) {
      const hosts = new Set(Array.from(allowedHosts, host => String(host).toLowerCase()))
      if (!hosts.has(url.hostname.toLowerCase())) return false
    }
    return true
  } catch (err) {
    return false
  }
}

const safeFilename = (value, fallback = 'file') => {
  const normalized = String(value == null ? '' : value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+/g, '-')
    .slice(0, 120)
  return normalized || fallback
}

module.exports = {
  ALLOWED_MARKUP_TAGS,
  escapeHtml,
  sanitizeMarkup,
  assertSafeRelativePath,
  isPathInside,
  resolveInside,
  resolveForWriteInside,
  pathExists,
  MAX_PROJECT_FILE_SIZE,
  assertReadableFile,
  readFileUtf8Bounded,
  sanitizeJsonValue,
  isSafeExternalUrl,
  safeFilename
}
