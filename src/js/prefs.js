const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const os = require("os")
const R = require('ramda')
const log = require('./shared/storyboarder-electron-log')

const pkg = require('../../package.json')
const util = require('./utils/index') // for Object.equals

let prefFile
const MAX_PREFS_FILE_SIZE = 5 * 1024 * 1024

const isUnsafeKey = key => key === '__proto__' || key === 'prototype' || key === 'constructor'
const sanitizePrefValue = (value, depth = 0) => {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (depth > 8) return undefined
  if (Array.isArray(value)) return value.slice(0, 10000).map(item => sanitizePrefValue(item, depth + 1))
  if (typeof value !== 'object') return undefined
  const result = {}
  for (const [key, item] of Object.entries(value).slice(0, 10000)) {
    if (isUnsafeKey(key)) continue
    const sanitized = sanitizePrefValue(item, depth + 1)
    if (sanitized !== undefined) result[key] = sanitized
  }
  return result
}

const defaultPrefs = {
  version: pkg.version,
  enableDrawingSoundEffects: false,
  enableDrawingMelodySoundEffects: false,
  enableUISoundEffects: false,
  enableHighQualityAudio: false,
  enableTooltips: true,
  enableAspirationalMessages: true,
  defaultBoardTiming: 2000,
  pomodoroTimerMinutes: 25,
  importTargetLayer: "reference", // DEPRECATED was used for image import but never had UI
  enableCanvasPaintingOpacity: true, // DEPRECATED used by old SketchPane
  enableBrushCursor: true,
  enableStabilizer: true, // DEPRECATED used by old SketchPane
  enableAnalytics: true,
  enableAutoSave: true,
  enableForcePsdReloadOnFocus: true,
  absolutePathToImageEditor: undefined,
  enableDiagnostics: false, // added in 1.6.x, FPS meter
  enableMcp: false,
  
  lastUsedFps: 24,

  // notifications
  allowNotificationsForLineMileage: true,
  enableNotifications: true,

  import: {
    offset: [0, 0],
    skipBlankBoards: true
  },

  enableBoardAudition: true,
  enableHighQualityDrawingEngine: true,

  straightLineDelayInMsecs: 650,

  // licensed
  enableWatermark: true,
  userWatermark: undefined

  // Print and PDF Export (optional)
  // printProjectState: { … }

  // Print Worksheet (optional)
  // NOTE this was the original key, before the feature was split into two windows (Print/PDF and Worksheet)
  // TODO could rename (and write prefs migration) to be less confusing, e.g. printWorksheetState
  // printingWindowState: { … }
}

// For slow computers, override the defaults here.
let cpus = os.cpus()
let cpu = cpus[0]
if(cpus.length <= 2 || cpu.speed <= 2000) {
  defaultPrefs.enableDrawingSoundEffects = false
  defaultPrefs.enableDrawingMelodySoundEffects = false
  defaultPrefs.enableUISoundEffects = false
  defaultPrefs.enableCanvasPaintingOpacity = false // DEPRECATED used by old SketchPane
  defaultPrefs.enableStabilizer = false // DEPRECATED used by old SketchPane
}

let prefs

const verify = data => {
  if (data.userWatermark) {
    if (fs.existsSync(path.join(app.getPath('userData'), 'watermark.png'))) {
      log.info('found watermark file')
    } else {
      log.info('could not find custom watermark file. reverting to default.')
      data.userWatermark = undefined
    }
  }
  return data
}

const load = () => {
  try {
    // load existing prefs
    // log.info("READING FROM DISK")
    const stat = fs.statSync(prefFile)
    if (!stat.isFile() || stat.size > MAX_PREFS_FILE_SIZE) throw new Error('Preferences file is too large or invalid')
    // Keep the Buffer overload for compatibility with the repository's
    // mock-fs based main-process tests.
    const parsed = JSON.parse(fs.readFileSync(prefFile))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Preferences must be an object')
    prefs = verify(sanitizePrefValue(parsed))
  } catch (e) {
    log.error('Could not read prefs. Loading defaults.')
    log.error(e)
    prefs = defaultPrefs
    try {
      savePrefs(prefs)
    } catch (e) {
      //log.info(e)
    }
  }
}

const savePrefs = (newPref) => {
  // log.info('SAVEPREFS')
  if (!newPref) return
  newPref = sanitizePrefValue(newPref)
  if (!newPref || typeof newPref !== 'object' || Array.isArray(newPref)) return
  if (Object.equals(newPref,prefs)) {
    // log.info("IM THE SAME!!!!")
  } else {
    prefs = newPref
    // log.info("SAVING TO DISK")
    fs.writeFileSync(prefFile, JSON.stringify(newPref, null, 2))
  }
}

const set = (keyPath, value, sync) => {
  // log.info('SETTING')
  if (typeof keyPath !== 'string' || keyPath.length === 0 || keyPath.length > 256) return
  const keys = keyPath.split(/\./)
  if (keys.some(key => !key || key.length > 128 || isUnsafeKey(key))) return
  let obj = prefs
  while (keys.length > 1) {
    const key = keys.shift()
    // A malformed preference file may contain a scalar where a nested
    // preference object is expected.  Do not let an IPC-originated dotted
    // key turn that inconsistency into a renderer-visible TypeError.
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      obj[key] = {}
    }
    if (!obj[key] || typeof obj[key] !== 'object' || Array.isArray(obj[key])) return
    obj = obj[key]
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  let keyProp = keys.shift()
  if (value !== undefined) {
    value = sanitizePrefValue(value)
    if (value === undefined) return
  }
  let prevValue = obj[keyProp]
  if (Object.equals(prevValue,value)) {
    //log.info("IM THE SAME!!!!")
  } else {
    obj[keyProp] = value
    //log.info("SAVING TO DISK")
    //log.info(prefs)
    if (sync) {
      fs.writeFileSync(prefFile, JSON.stringify(prefs, null, 2))
    } else {
      fs.writeFile(prefFile, JSON.stringify(prefs, null, 2), (err) => {
        // log.info("SAVED ASYNC")
      })
    }
  }
}

const getPrefs = (from) => {
  // log.info("GETTING PREFS!!!", from)
  return util.stringifyClone(prefs) // TODO why do we have to clone this?
}

const migrate = (_currentPrefs, _defaultPrefs) => {
  log.info(`Migrating preferences from ${_currentPrefs.version} to v${_defaultPrefs.version}`)

  // Set properties only if they don't exist
  // via https://github.com/ramda/ramda/wiki/Cookbook#set-properties-only-if-they-dont-exist
  const currentPrefs = sanitizePrefValue(_currentPrefs) || {}
  let mergedPrefs = Object.assign(
    R.merge(_defaultPrefs, currentPrefs),
    { version: _defaultPrefs.version }
  )

  return mergedPrefs
}

const compareVersions = (v1, v2) => {
  for (let i = 0; i < v1.length; i++) {
    if (v1[i] < v2[i]) {
      return -1
    } else if (v1[i] > v2[i]) {
      return +1
    }
  }

  return 0
}

// naive check, assumes lengths are equal and format is simply `major.minor.patch`
const versionCanBeMigrated = (from, to) => {
  let v1 = from.split('.').map(n => parseInt(n, 10))
  let v2 = to.split('.').map(n => parseInt(n, 10))
  return compareVersions(v1, v2) === -1
}

const init = _prefFile => {
  prefFile = _prefFile
  log.info('Loading preferences from', prefFile)

  load()
  if (versionCanBeMigrated(prefs.version, defaultPrefs.version)) {
    let newPrefs = migrate(prefs, defaultPrefs)
    savePrefs(newPrefs)
  }
}

const revokeLicense = () => {
  set('enableWatermark', defaultPrefs.enableWatermark, true)
  set('userWatermark', defaultPrefs.userWatermark, true)
}

module.exports = {
  savePrefs,
  getPrefs,
  set,

  init,
  versionCanBeMigrated,

  revokeLicense
}
