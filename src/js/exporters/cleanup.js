const fs = require('fs')
const path = require('path')
const trash = require('trash')

const boardModel = require('../models/board')
const util = require('../utils')
const {
  MAX_PROJECT_FILE_SIZE,
  assertReadableFile,
  readFileUtf8Bounded,
  resolveInside,
  resolveForWriteInside,
  pathExists
} = require('../utils/security')

const zip = (a, b) => a.map((v, n) => [v, b[n]])

const flatten = arr => Array.prototype.concat(...arr)

const cleanupScene = (absolutePathToStoryboarderFile, trashFn = trash) => {
  return new Promise((resolve, reject) => {
    absolutePathToStoryboarderFile = assertReadableFile(absolutePathToStoryboarderFile, MAX_PROJECT_FILE_SIZE)
    let absolutePathToImagesFolder = resolveInside(path.dirname(absolutePathToStoryboarderFile), 'images')
    let originalBoardData = JSON.parse(readFileUtf8Bounded(absolutePathToStoryboarderFile, MAX_PROJECT_FILE_SIZE))
    if (!originalBoardData || !Array.isArray(originalBoardData.boards)) {
      throw new Error('The project does not contain a valid boards array')
    }
    originalBoardData.boards = originalBoardData.boards
      .filter(board => board && typeof board === 'object' && !Array.isArray(board))

    const {
      renamablePairs,
      boardData
    } = prepareCleanup(originalBoardData)

    try {
      // rename the renamable files (layers, thumbnails, linked files)
      for (let p of [...renamablePairs]) {
        let from
        let to
        try {
          from = resolveForWriteInside(absolutePathToImagesFolder, p.from)
          to = resolveForWriteInside(absolutePathToImagesFolder, p.to)
        } catch (err) {
          console.warn(`Skipping invalid project media rename: ${p.from} -> ${p.to}`)
          continue
        }
        if (pathExists(from)) {
          // console.log('rename', p.from, p.to)
          fs.renameSync(from, to)
        } else {
          // console.log('skip', p.from, p.to)
        }
      }

      // if the linked file does not exist, delete it from data
      boardData.boards = boardData.boards.map(b => {
        let linkPath
        try {
          linkPath = b.link && resolveForWriteInside(absolutePathToImagesFolder, b.link)
        } catch (err) {
          linkPath = null
        }
        if (b.link && (!linkPath || !pathExists(linkPath))) {
          // console.log('could not find', b.link)
          // console.log('removing link')
          delete b.link
        }
        return b
      })

      // if the audio file does not exist, delete the audio object from the board data
      boardData.boards.forEach(b => {
        let audioPath
        try {
          audioPath = b.audio && resolveForWriteInside(absolutePathToImagesFolder, b.audio.filename)
        } catch (err) {
          audioPath = null
        }
        if (b.audio && (!audioPath || !pathExists(audioPath))) {
          delete b.audio
        }
      })

      //
      //
      // find and delete unused files ...
      //

      // ... first, find all used filenames for: layers, thumbnails, links
      const usedFiles = flatten(boardData.boards.map(boardModel.getMediaFilenames))

      const allFiles = fs.readdirSync(absolutePathToImagesFolder)
      const unusedFiles = allFiles.filter(filename => !usedFiles.includes(filename))

      // Only hand regular, contained files to the trash implementation.  In
      // particular, do not follow a symlink or pass an unexpected directory
      // from a hostile project to a recursive delete operation.
      const absolutePathToUnusedFiles = unusedFiles.map(filename => {
        try {
          const lexical = path.join(absolutePathToImagesFolder, filename)
          const lexicalStat = fs.lstatSync(lexical)
          if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink()) return null
          const candidate = resolveForWriteInside(absolutePathToImagesFolder, filename)
          return fs.statSync(candidate).isFile() ? candidate : null
        } catch (err) {
          console.warn(`Skipping unsafe unused media path: ${filename}`)
          return null
        }
      }).filter(Boolean)

      // ... now, delete unused files ...
      trashFn(absolutePathToUnusedFiles).then(() => {

        // ... then, save JSON
        fs.writeFileSync(absolutePathToStoryboarderFile, JSON.stringify(boardData, null, 2))
      
        resolve(boardData)
      }).catch(err => {
        console.error(err)
        reject(err)
      })

    } catch (err) {
      console.error(err)
      reject(err)
    }
  })
}

const prepareCleanup = boardData => {
  let originalData = boardData
  if (!originalData || !Array.isArray(originalData.boards)) {
    return { renamablePairs: [], boardData: { ...(originalData || {}), boards: [] } }
  }
  originalData = {
    ...originalData,
    boards: originalData.boards.filter(board => board && typeof board === 'object' && !Array.isArray(board))
  }
  let cleanedData = util.stringifyClone(boardData)
  if (!cleanedData || !Array.isArray(cleanedData.boards)) {
    return { renamablePairs: [], boardData: { ...originalData, boards: [] } }
  }
  cleanedData.boards = cleanedData.boards
    .filter(board => board && typeof board === 'object' && !Array.isArray(board))
  cleanedData.boards = cleanedData.boards
                        .map(boardModel.updateUrlsFromIndex)
                        .map(b => {
                          if (b.link) {
                            b.link = boardModel.boardFilenameForLink(b)
                          }
                          return b
                        })
    // TODO could update board number?
    // TODO could update shot index? see renderThumbnailDrawer

  let pairs = zip(originalData.boards, cleanedData.boards)

  let layerFilenamePairs = flatten(pairs.map(([o, c]) => {
      let filenamesO = boardModel.boardOrderedLayerFilenames(o).filenames
      let filenamesC = boardModel.boardOrderedLayerFilenames(c).filenames
      return zip(filenamesO, filenamesC)
    }))

  let thumbnailPairs = zip(
    originalData.boards.map(boardModel.boardFilenameForThumbnail),
     cleanedData.boards.map(boardModel.boardFilenameForThumbnail)
   )

  let linkPairs = zip(
    originalData.boards.map(b => b.link),
     cleanedData.boards.map(b => b.link)
   )
   linkPairs = linkPairs.filter(pairs => !util.isUndefined(pairs[0]))

  let posterframePairs = zip(
    originalData.boards.map(boardModel.boardFilenameForPosterFrame),
    cleanedData.boards.map(boardModel.boardFilenameForPosterFrame)
  )

  // concat file pairs
  let renamablePairs = [...layerFilenamePairs, ...thumbnailPairs, ...linkPairs, ...posterframePairs]
    .filter(([a, b]) => a !== b) // include only filenames that require renaming
    .map(([a, b]) => ({ from: a, to: b }))

  return {
    renamablePairs,
    boardData: cleanedData
  }
}

module.exports = {
  cleanupScene,

  prepareCleanup
}
