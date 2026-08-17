const fs = require('fs')
const { resolveForWriteInside, safeFilename } = require('../utils/security')

class CanvasBufferOutputFileStrategy {
  constructor(options) {
    this.exportsPath = options.exportsPath
  }

  flush(buffer, pool) {
    return new Promise((fulfill, reject) => {
      let result = []
      let writes = []
      while(buffer.length) {
        let bufferData = buffer.splice(0, 1)[0]
        const rawFilename = bufferData.metaData && bufferData.metaData.filename
        const filename = typeof rawFilename === 'string' &&
          rawFilename.length > 0 && rawFilename.length <= 120 &&
          !/[\\/\0<>:"|?*]/.test(rawFilename)
          ? rawFilename
          : safeFilename(rawFilename, 'frame')
        const frameNum = Number.isInteger(bufferData.metaData && bufferData.metaData.frameNum) &&
          bufferData.metaData.frameNum >= 0 && bufferData.metaData.frameNum <= 1000000
          ? bufferData.metaData.frameNum
          : 0
        let filepath = resolveForWriteInside(this.exportsPath, `${filename}-${frameNum}.png`)
        result.push(filepath)
        let imageData = bufferData.canvas
          .toDataURL('image/png')
          .replace(/^data:image\/\w+;base64,/, '')
        writes.push(new Promise((resolve, rejectWrite) => {
          fs.writeFile(filepath, imageData, 'base64', error => error ? rejectWrite(error) : resolve())
        }))
        if(pool) {
          pool.push(bufferData.canvas)
        }
      }
      Promise.all(writes).then(() => fulfill(result), reject)
    })
  }
}

module.exports = CanvasBufferOutputFileStrategy
