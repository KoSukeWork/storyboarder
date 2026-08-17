const fs = require('fs-extra')
const path = require('path')
const R = require('ramda')

const boardModel = require('../models/board')

const {
  MAX_PROJECT_FILE_SIZE,
  assertReadableFile,
  resolveInside,
  resolveForWriteInside,
  pathExists
} = require('../utils/security')

const MAX_SCENE_DIRECTORIES = 10000
const MAX_SETTINGS_FILE_SIZE = 10 * 1024 * 1024

const getRelativeMediaPathsUsedByScene = scene => {
  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.boards)) {
    throw new Error('Invalid storyboard project data')
  }
  if (scene.boards.length > 100000) throw new Error('Storyboard contains too many boards')
  return R.flatten(scene.boards.map(boardModel.getMediaFilenames))
}

const getAllAbsoluteFilePathsUsedByScene = (srcFilePath, options = { copyBoardUrlMainImages: false }) => {
  srcFilePath = assertReadableFile(srcFilePath, MAX_PROJECT_FILE_SIZE)
  let srcFolderPath = path.dirname(srcFilePath)
  let imagesPath = path.join(srcFolderPath, 'images')
  // read the scene
  let scene = JSON.parse(fs.readFileSync(srcFilePath, 'utf8'))
  // find all the image files used in the scene
  let usedMediaFiles = getRelativeMediaPathsUsedByScene(scene)

  // for compatibility with old scenes prior to Storyboarder 1.6.x
  // can optionally copy board.url "main layer" images
  let boardUrlMainImages = []
  if (options.copyBoardUrlMainImages) {
    for (let board of scene.boards) {
      try {
        let filename = resolveForWriteInside(imagesPath, board.url)
        if (pathExists(filename)) {
          boardUrlMainImages.push(filename)
        }
      } catch (err) {
        if (!options.ignoreMissing) throw new Error(`Invalid project media path: ${board.url}`)
        console.warn(`Skipping invalid project media path: ${board.url}`)
      }
    }
  }

  const resolveMedia = filename => {
    try {
      return resolveForWriteInside(imagesPath, filename)
    } catch (err) {
      if (!options.ignoreMissing) throw new Error(`Invalid project media path: ${filename}`)
      console.warn(`Skipping invalid project media path: ${filename}`)
      return null
    }
  }

  return [
    // srcFilePath,
    ...usedMediaFiles.map(resolveMedia).filter(Boolean),
    ...boardUrlMainImages
  ]
}

// srcFilePath: absolute path to project file (.storyboarder or .fountain/.fdx)
const getFilesUsedByProject = (srcFilePath, options = { copyBoardUrlMainImages: false }) => {
  srcFilePath = assertReadableFile(srcFilePath, MAX_PROJECT_FILE_SIZE)
  // for convenience
  let srcFolderPath = path.dirname(srcFilePath)

  // is this a multi-scene project?
  const isMultiScene = (path.extname(srcFilePath) === '.fountain' || path.extname(srcFilePath) === '.fdx')

  if (isMultiScene) {
    let files = []

    // .fountain file
    // files.push(srcFilePath)

    let scenesDirsPath
    let settingsFilePath
    try {
      scenesDirsPath = resolveInside(srcFolderPath, 'storyboards')
      settingsFilePath = resolveInside(scenesDirsPath, 'storyboard.settings')
      assertReadableFile(settingsFilePath, MAX_SETTINGS_FILE_SIZE)
    } catch (err) {
      throw new Error('This script is not part of a Storyboarder project')
    }

    // copy the storyboard.settings file
    files.push(settingsFilePath)

    // for each of the scenes in `storyboards/`, add their files as well
    const sceneEntries = fs.readdirSync(scenesDirsPath)
    if (sceneEntries.length > MAX_SCENE_DIRECTORIES) {
      throw new Error('Project contains too many scene directories')
    }
    let sceneDirs = sceneEntries.filter(file => {
      try {
        const lexicalPath = path.join(scenesDirsPath, file)
        const stat = fs.lstatSync(lexicalPath)
        return stat.isDirectory() && !stat.isSymbolicLink() && Boolean(resolveInside(scenesDirsPath, file))
      } catch (err) {
        console.warn(`Skipping invalid scene directory: ${file}`)
        return false
      }
    })

    for (let dir of sceneDirs) {
      // find the first .storyboarder file in the directory
      let parentPath = resolveInside(scenesDirsPath, dir)
      const sceneEntries = fs.readdirSync(parentPath)
      if (sceneEntries.length > 10000) throw new Error(`Scene directory contains too many files: ${dir}`)
      let storyboarderFilename = sceneEntries.find(file => path.extname(file).toLowerCase() === '.storyboarder')

      if (storyboarderFilename) {
        let storyboarderFilePath = resolveInside(parentPath, storyboarderFilename)
        assertReadableFile(storyboarderFilePath, MAX_PROJECT_FILE_SIZE)
        files.push(storyboarderFilePath, ...getAllAbsoluteFilePathsUsedByScene(storyboarderFilePath, options))
      } else {
        // can't find a .storyboarder file
        console.warn(`Missing expected .storyboarder file in ${parentPath}`)
      }
    }

    return files
  } else {
    return getAllAbsoluteFilePathsUsedByScene(srcFilePath, options)
  }
}

// copy the project files
//
// single-scene or multi-scene
// (for multi-scene, this includes .fountain/.fdx and .settings and scene folders)
//
// for each scene ...
//   ... grab all the files in the scene
//   ... for multi-scene, grab the script and .settings
//
// srcFilePath:   absolute path to source project .storyboarder or .fountain/.fdx
//
// dstFolderPath: absolute path to destination folder
//                basename will be used to rename the destination project file
//
// options:
// copyBoardUrlMainImages: if true, copy `.url` main layer image filenames used in boards prior to 1.6. (default: false)
//
const copyProject = (
  srcFilePath,
  dstFolderPath,
  options = {
    copyBoardUrlMainImages: false,
    ignoreMissing: false
  }
) => {
  const safeSrcFilePath = assertReadableFile(srcFilePath, MAX_PROJECT_FILE_SIZE)
  let srcFolderPath = path.dirname(safeSrcFilePath)

  // console.log('Copying project', srcFilePath, 'to folder', dstFolderPath)

  let files = getFilesUsedByProject(safeSrcFilePath, options)

  let dstBasename = path.basename(dstFolderPath)
  let dstExt = path.extname(safeSrcFilePath)

  if (!pathExists(dstFolderPath) || !fs.statSync(dstFolderPath).isDirectory()) {
    throw new Error(`ENOENT: could not find destination folder ${dstFolderPath}`)
  }
  const resolvedDestination = path.resolve(dstFolderPath)
  const safeDestinationRoot = resolveInside(path.dirname(resolvedDestination), path.basename(resolvedDestination))

  const projectDestination = resolveForWriteInside(safeDestinationRoot, `${dstBasename}${dstExt}`)
  let pairs = [
    // project file
    { from: safeSrcFilePath, to: projectDestination },

    // interior files
    ...files.map(from => {
      // Derive destinations from a validated relative path.  String prefix
      // replacement can turn a path such as `/project-evil/file` into an
      // unexpected destination when project names share a prefix.
      const relative = path.relative(srcFolderPath, from)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Source file is outside the project: ${from}`)
      }
      return {
        from,
        to: resolveForWriteInside(safeDestinationRoot, relative)
      }
    })
  ]

  let missing = []
  pairs.forEach(({ from, to }) => {
    if (pathExists(from)) {
      fs.copySync(from, to)
    } else {
      missing.push(from)
      if (!options.ignoreMissing) {
        throw new Error(`ENOENT: could not find source file ${from}`)
      }
    }
  })
  return { missing }
}

module.exports = {
  getFilesUsedByProject,
  copyProject
}
