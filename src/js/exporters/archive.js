const fs = require('fs-extra')
const path = require('path')
const tmp = require('tmp')
const archiver = require('archiver')

const exporterCopyProject = require('./copy-project')
const { safeFilename } = require('../utils/security')

const assertArchiveOutputFilepath = filepath => {
  if (
    typeof filepath !== 'string' || filepath.length === 0 || filepath.length > 4096 ||
    filepath.includes('\0') || !path.isAbsolute(filepath) || path.extname(filepath).toLowerCase() !== '.zip'
  ) {
    throw new Error('A valid absolute ZIP output path is required')
  }

  const resolved = path.resolve(filepath)
  fs.ensureDirSync(path.dirname(resolved))
  const safePath = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved))
  if (fs.existsSync(safePath)) {
    const stat = fs.lstatSync(safePath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('ZIP output must be a regular file')
  }
  return safePath
}

const exportAsZIP = async (srcFilePath, exportFilePath) => {
  exportFilePath = assertArchiveOutputFilepath(exportFilePath)
  // create temporary folder
  let tmpdir = tmp.dirSync({ unsafeCleanup: true })

  let tmpZipFilePath

  let missing

  try {
    // copy project to folder
    const projectName = safeFilename(path.basename(srcFilePath, path.extname(srcFilePath)), 'project')
    let dstFolderPath = path.join(tmpdir.name, projectName)
    // let dstFilePath = path.join(dstFolderPath, path.basename(srcFilePath))

    // if directory present, delete all its files
    // if directory not present, create it
    fs.emptyDirSync(dstFolderPath)

    // copy files
    const result = exporterCopyProject.copyProject(srcFilePath, dstFolderPath, { ignoreMissing: true })
    missing = result.missing

    try {
      await new Promise((resolve, reject) => {
        // zip the folder
        tmpZipFilePath = path.join(tmpdir.name, `${projectName}-${Date.now()}.zip`)
        // console.log('writing', tmpZipFilePath)
        let output = fs.createWriteStream(tmpZipFilePath)
        let archive = archiver('zip', {
          zlib: { level: 9 } // compression level
        })
        // listen for all archive data to be written
        output.on('close', function() {
          // console.log(archive.pointer() + ' total bytes')
          // console.log('archiver has been finalized and the output file descriptor has closed.')
          resolve()
        })
        output.on('error', reject)
        // good practice to catch warnings (ie stat failures and other non-blocking errors)
        archive.on('warning', function(err) {
          if (err.code === 'ENOENT') {
            // throw error
            reject(err)
          } else {
            // throw error
            reject(err)
          }
        })
        // good practice to catch this error explicitly
        archive.on('error', function(err) {
          reject(err)
        })
        // pipe archive data to the file
        archive.pipe(output)    

        // append files from a directory, putting its contents at the root of archive
        archive.directory(dstFolderPath, false)

        // finalize the archive (ie we are done appending files but streams have to finish yet)
        const finalizing = archive.finalize()
        if (finalizing && typeof finalizing.catch === 'function') finalizing.catch(reject)
      })

      // copy zip to exports
      fs.copySync(tmpZipFilePath, exportFilePath)
    } catch (err) {
      // console.log('got an error :/')
      // console.error(err)
      throw err
    }
  } finally {
    // cleanup
    tmpdir.removeCallback()
  }

  return { missing }
}

module.exports = {
  exportAsZIP
}
