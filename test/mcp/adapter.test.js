const assert = require('assert')
const fs = require('fs')

const { AdapterError, dataUrlFromSource, MAX_IMAGE_DIMENSION } = require('../../src/js/window/mcp-adapter')

describe('Storyboarder MCP renderer adapter validation', () => {
  it('accepts real PNG/JPEG bytes and reports their dimensions', () => {
    const png = fs.readFileSync('test/fixtures/example/images/board-8-9JDBY-thumbnail.png')
    const jpeg = fs.readFileSync('test/fixtures/example/images/board-8-9JDBY-posterframe.jpg')
    const pngResult = dataUrlFromSource({ mimeType: 'image/png', dataBase64: png.toString('base64') })
    const jpegResult = dataUrlFromSource({ mimeType: 'image/jpeg', dataBase64: jpeg.toString('base64') })
    assert(pngResult.width > 0 && pngResult.height > 0)
    assert(jpegResult.width > 0 && jpegResult.height > 0)
  })

  it('rejects spoofed MIME, malformed Base64, and oversized dimensions', () => {
    assert.throws(() => dataUrlFromSource({ mimeType: 'image/png', dataBase64: Buffer.from('not an image').toString('base64') }), error => error instanceof AdapterError && error.code === 'VALIDATION_FAILED')
    assert.throws(() => dataUrlFromSource({ mimeType: 'image/jpeg', dataBase64: '%%%%' }), error => error instanceof AdapterError && error.code === 'VALIDATION_FAILED')

    const png = Buffer.alloc(33)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(0x0d0a1a0a, 4)
    png.writeUInt32BE(13, 8)
    png.write('IHDR', 12, 4, 'ascii')
    png.writeUInt32BE(MAX_IMAGE_DIMENSION + 1, 16)
    png.writeUInt32BE(1, 20)
    assert.throws(() => dataUrlFromSource({ mimeType: 'image/png', dataBase64: png.toString('base64') }), error => error instanceof AdapterError && error.code === 'VALIDATION_FAILED')
  })
})
