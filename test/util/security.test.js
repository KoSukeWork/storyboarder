const assert = require('assert')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const {
  assertSafeRelativePath,
  resolveInside,
  resolveForWriteInside,
  assertReadableFile,
  readFileUtf8Bounded,
  sanitizeJsonValue,
  sanitizeMarkup,
  safeFilename,
  isSafeExternalUrl
} = require('../../src/js/utils/security')

describe('security utilities', () => {
  it('escapes markup when no DOM is available', () => {
    const result = sanitizeMarkup('<img src=x onerror=alert(1)>Hello <strong>world</strong>')
    assert.strictEqual(result, '&lt;img src=x onerror=alert(1)&gt;Hello &lt;strong&gt;world&lt;/strong&gt;')
  })

  it('rejects absolute and traversal paths', () => {
    for (const value of ['../outside.png', 'folder/../../outside.png', '.', './', 'C:\\outside.png', 'C:outside.png', '\\\\server\\share\\x.png', '//server/share/x.png', '/etc/passwd', 'x\0.png']) {
      assert.throws(() => assertSafeRelativePath(value))
    }
  })

  it('resolves existing files inside a project only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-security-'))
    const images = path.join(root, 'images')
    fs.ensureDirSync(images)
    fs.writeFileSync(path.join(images, 'inside.png'), 'ok')
    assert.strictEqual(resolveInside(images, 'inside.png'), path.join(images, 'inside.png'))
    assert.throws(() => resolveInside(images, '../outside.png'))
    fs.removeSync(root)
  })

  it('validates paths that will be created', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-security-'))
    const images = path.join(root, 'images')
    fs.ensureDirSync(images)
    assert.strictEqual(resolveForWriteInside(images, 'new.png'), path.join(images, 'new.png'))
    assert.throws(() => resolveForWriteInside(images, '../outside.png'))
    fs.removeSync(root)
  })

  it('bounds metadata files before reading them', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-security-'))
    const filepath = path.join(root, 'project.storyboarder')
    fs.writeFileSync(filepath, '12345')
    assert.strictEqual(assertReadableFile(filepath, 5), filepath)
    assert.strictEqual(readFileUtf8Bounded(filepath, 5), '12345')
    assert.throws(() => readFileUtf8Bounded(filepath, 4), /size limit/i)
    assert.throws(() => assertReadableFile('relative.storyboarder'), /absolute/i)
    fs.removeSync(root)
  })

  it('removes prototype keys and bounds user-editable JSON graphs', () => {
    const parsed = JSON.parse('{"safe":{"value":1},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"items":[1,2,3]}')
    const result = sanitizeJsonValue(parsed, { maxEntries: 20, maxArrayLength: 2 })
    assert.deepStrictEqual(result, { safe: { value: 1 }, items: [1, 2] })
    assert.strictEqual({}.polluted, undefined)
  })

  it('rejects symlink escapes for existing and future files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-security-'))
    const images = path.join(root, 'images')
    const outside = path.join(root, '..', `storyboarder-security-outside-${Date.now()}.png`)
    fs.ensureDirSync(images)
    fs.writeFileSync(outside, 'outside')
    try {
      fs.symlinkSync(outside, path.join(images, 'link.png'), 'file')
      assert.throws(() => resolveInside(images, 'link.png'), /outside|escape/i)
      assert.throws(() => resolveForWriteInside(images, 'link.png'), /outside|escape/i)
      fs.removeSync(path.join(images, 'link.png'))
    } catch (err) {
      // Creating symlinks may be disabled on Windows CI without developer mode.
      if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err
    } finally {
      fs.removeSync(outside)
      fs.removeSync(root)
    }
  })

  it('rejects a media root symlink that points outside its project parent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-security-'))
    const project = path.join(root, 'project')
    const outside = path.join(root, 'outside')
    const linkedImages = path.join(project, 'images')
    fs.ensureDirSync(project)
    fs.ensureDirSync(outside)
    fs.writeFileSync(path.join(outside, 'outside.png'), 'outside')
    try {
      fs.symlinkSync(outside, linkedImages, 'junction')
      assert.throws(() => resolveInside(linkedImages, 'outside.png'), /escapes|outside/i)
      assert.throws(() => resolveForWriteInside(linkedImages, 'new.png'), /escapes|outside/i)
    } catch (err) {
      // Creating symlinks/junctions may be disabled on Windows CI.
      if (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'ENOSYS') throw err
    } finally {
      fs.removeSync(root)
    }
  })

  it('creates a filesystem-safe scene name from script text', () => {
    assert.strictEqual(safeFilename('../../evil\\scene:1'), 'evil-scene-1')
    assert.strictEqual(safeFilename('', 'scene'), 'scene')
  })

  it('restricts external links to HTTPS and an explicit host allow-list', () => {
    assert.strictEqual(isSafeExternalUrl('https://storyboarders.com/project/123', ['storyboarders.com']), true)
    assert.strictEqual(isSafeExternalUrl('http://storyboarders.com/project/123', ['storyboarders.com']), false)
    assert.strictEqual(isSafeExternalUrl('https://evil.example/project/123', ['storyboarders.com']), false)
    assert.strictEqual(isSafeExternalUrl('javascript:alert(1)'), false)
  })
})
