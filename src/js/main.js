const {app, ipcMain, BrowserWindow, dialog, powerSaveBlocker, protocol, shell, clipboard, nativeImage} = electron = require('electron')
const { execFile } = require('child_process')
const FormData = require('form-data')

const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')
const isDev = !app.isPackaged
const trash = require('trash')
const chokidar = require('chokidar')
const os = require('os')
const log = require('./shared/storyboarder-electron-log')
log.initialize()
const fileSystem = require('fs')
const EventEmitter = require('events')

const prefModule = require('./prefs')
prefModule.init(path.join(app.getPath('userData'), 'pref.json'))

// The main renderer needs ordinary UI preferences, but it must never receive
// bearer credentials or other license material from the main process.  Keep
// the credential in the main process and expose only an authentication
// boolean to compatibility code in the renderer.
const sanitizeMainWindowPrefs = value => {
  const sanitized = sanitizeJsonValue(value, {
    maxDepth: 12,
    maxEntries: 10000,
    maxStringLength: 4096
  })
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return {}
  if (sanitized.auth && typeof sanitized.auth === 'object') {
    const token = value && typeof value === 'object' && value.auth && value.auth.token
    sanitized.auth = { authenticated: typeof token === 'string' && token.length > 0 && token.length <= 4096 }
  }
  // The configured editor path is not a credential and is required by the
  // existing editor UI.  Keep it as ordinary preference data while removing
  // the bearer token above.
  return sanitized
}

const MAIN_WINDOW_PREF_KEYS = new Set([
  'toolbar',
  'pomodoroTimerMinutes',
  'lastUsedFps'
])


const configureStore = require('./shared/store/configureStore')
const defaultKeyMap = require('./shared/helpers/defaultKeyMap')


const fountain = require('./vendor/fountain')
const fountainDataParser = require('./fountain-data-parser')
const fountainSceneIdUtil = require('./fountain-scene-id-util')

const importerFinalDraft = require('./importers/final-draft')
const xml2js = require('xml2js')


const preferencesUI = require('./windows/preferences')()
const registration = require('./windows/registration/main')
const printProject = require('./windows/print-project/main')
const printProjectDataLoader = require('./windows/print-project/data')
const printProjectIpc = require('./windows/print-project/ipc-services')
const printWorksheet = require('./windows/print-worksheet/main')
const worksheetPrinter = require('./windows/print-worksheet/worksheet-printer')
const createPrint = require('./print')
const { StoryboarderMcpService } = require('./mcp/server')

const JWT = require('jsonwebtoken')

const pkg = require('../../package.json')
const projectMetadata = require('./project-metadata')
const util = require('./utils/index')
const {settings:languageSettings} = require('./services/language.config')
const autoUpdater = require('./auto-updater')
const { buildEditorCommand } = require('./utils/editor-command')
const LanguagePreferencesWindow = require('./windows/language-preferences/main')
const {
  assertReadableFile,
  assertSafeRelativePath,
  isPathInside,
  pathExists,
  readFileUtf8Bounded,
  resolveInside,
  resolveForWriteInside,
  sanitizeJsonValue,
  safeFilename
} = require('./utils/security')
const UPLOAD_API_LOGIN = 'https://storyboarders.com/api/login'
const UPLOAD_API_HOST = 'storyboarders.com'
const MAX_UPLOAD_LOGIN_FIELD_LENGTH = 4096
const MAX_PROJECT_INPUT_SIZE = 50 * 1024 * 1024
const MAX_WEB_ZIP_FILE_SIZE = 500 * 1024 * 1024
//https://github.com/luiseduardobrito/sample-chat-electron

//
//
// Menu
// 
const createMenu = require('./main/menu')
const menuBus = new EventEmitter()

/*
TODO
used by license registration, which is disabled currently
see: windows/registration
auth.json can be saved/loaded, e.g.:

    const observeStore = require('./shared/helpers/observeStore')
    const throttle = require('lodash.throttle')
    const authStorage = require('./shared/store/authStorage')
    const persistedState = authStorage.loadState()
    const store = configureStore({ ...persistedState })
    observeStore(
      store,
      state => state.auth,
      throttle(() => authStorage.saveState({ auth: store.getState().auth }), 5000)
    )
*/
const store = configureStore()


if (isDev) {
  const { default: installExtension, REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } = require('electron-devtools-installer')

  app.whenReady().then(() => {
    installExtension([REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS])
      .then((name) => console.log(`[Extensions] ADD ${name}`))
      .catch((err) => console.log('[Extensions] ERR: ', err))
  })
}


let welcomeWindow
let newWindow

let mainWindow
let sketchWindow
let keyCommandWindow
let aboutWindow

let loadingStatusWindow
let uploadWindow

let welcomeInprogress
let stsWindow

let scriptWatcher

let powerSaveId = 0

let previousScript

let prefs = prefModule.getPrefs('main')

// state
let currentFile
let currentFileLastModified
let currentPath
let currentScriptDataObject // used to store data until 'createNew' ipc fires back
let activeWorksheetProjectData

let toBeOpenedPath

let isLoadingProject

// MCP desktop bridge state.  The MCP HTTP server stays in the main process;
// project data and canvas operations remain owned by the current renderer.
const mcpBridgePending = new Map()
const mcpBridgeQueue = []
let mcpService
let mcpRequestSequence = 0
let mcpRendererReady = false

// IPC is an application boundary even when the sender is one of the legacy
// Node-enabled windows.  Keep the allow-list in one place so new handlers do
// not accidentally accept messages from a detached or navigated WebContents.
const isWindowSender = (event, windows) => {
  const sender = event && event.sender
  if (!sender) return false
  return windows.some(win => win && !win.isDestroyed() && win.webContents === sender)
}

const isMainWindowSender = event => isWindowSender(event, [mainWindow])
const isWelcomeWindowSender = event => isWindowSender(event, [welcomeWindow])
const isNewWindowSender = event => isWindowSender(event, [newWindow])
const isPreferencesWindowSender = event => isWindowSender(event, [preferencesUI && preferencesUI.getWindow && preferencesUI.getWindow()])
const isKnownAppWindowSender = event => isWindowSender(event, [
  mainWindow,
  welcomeWindow,
  newWindow,
  keyCommandWindow,
  loadingStatusWindow,
  preferencesUI && preferencesUI.getWindow && preferencesUI.getWindow(),
  printProject && printProject.getWindow && printProject.getWindow(),
  printWorksheet && printWorksheet.getWindow && printWorksheet.getWindow(),
  LanguagePreferencesWindow && LanguagePreferencesWindow.getWindow && LanguagePreferencesWindow.getWindow()
])

app.on('before-quit', () => {
  stopMcpService().catch(err => log.warn('Could not stop Storyboarder MCP service', err.message))
})

ipcMain.on('mcp:response', (event, response = {}) => {
  if (!isMainWindowSender(event) || !response || typeof response !== 'object') return
  const requestId = typeof response.requestId === 'string' ? response.requestId : ''
  const pending = mcpBridgePending.get(requestId)
  if (!pending) return
  mcpBridgePending.delete(requestId)
  clearTimeout(pending.timer)
  pending.resolve(response.result || { ok: false, code: 'INTERNAL_ERROR', message: 'Empty MCP renderer response' })
})

ipcMain.on('mcp:changed', event => {
  if (!isMainWindowSender(event) || !mcpService) return
  mcpService.notifyResourcesChanged().catch(err => log.warn('Could not notify MCP resources', err.message))
})

ipcMain.handle('mcp:status', event => {
  if (!isMainWindowSender(event) && !isPreferencesWindowSender(event)) return { enabled: false }
  return mcpStatusForRenderer()
})

ipcMain.handle('mcp:set-enabled', async (event, value) => {
  if (!isPreferencesWindowSender(event)) return { ok: false, code: 'UNAUTHORIZED' }
  const enabled = value === true
  prefModule.set('enableMcp', enabled, true)
  try {
    const status = enabled ? await startMcpService() : await stopMcpService()
    return { ok: true, status: enabled ? status : mcpStatusForRenderer() }
  } catch (err) {
    log.warn('Could not change MCP service state', err.message)
    prefModule.set('enableMcp', false, true)
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Could not start MCP service' }
  }
})

// MCP PDF export reuses the existing, node-only print pipeline.  The current
// renderer supplies project data through the same strictly-scoped response
// channel used by the visible print window; no path supplied by MCP is used.
ipcMain.handle('mcp:export-pdf', async event => {
  if (!isMainWindowSender(event) || !mainWindow || mainWindow.isDestroyed() || !currentFile) {
    return { ok: false, code: 'NO_PROJECT', message: 'No Storyboarder project is open' }
  }
  try {
    const projectData = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ipcMain.removeListener('exportPDF:getProjectData-response', onResponse)
        reject(new Error('Timed out waiting for project data'))
      }, 30000)
      const onResponse = (responseEvent, value) => {
        if (!mainWindow || responseEvent.sender !== mainWindow.webContents) return
        clearTimeout(timeout)
        ipcMain.removeListener('exportPDF:getProjectData-response', onResponse)
        resolve(value)
      }
      ipcMain.on('exportPDF:getProjectData-response', onResponse)
      mainWindow.webContents.send('exportPDF:getProjectData-request')
    })
    const project = await printProjectDataLoader.getProjectData({ currentFilePath: currentFile, projectData })
    printProjectIpc.setProject(project)
    const result = await printProjectIpc.exportPdf({})
    const outputPath = path.relative(path.dirname(currentFile), result.filepath)
    if (!outputPath || outputPath.startsWith('..') || path.isAbsolute(outputPath)) throw new Error('PDF exporter returned an unsafe path')
    return { ok: true, format: 'pdf', outputPath }
  } catch (err) {
    log.warn('Could not export PDF for MCP request', err.message)
    return { ok: false, code: 'VALIDATION_FAILED', message: 'Could not export PDF' }
  }
})

const sendToMainWindow = (channel, ...args) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send(channel, ...args)
  return true
}

const createMcpBridge = () => ({
  request: (operation, payload = {}, { timeoutMs = 30000 } = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return Promise.resolve({ ok: false, code: 'NO_PROJECT', message: 'No Storyboarder project window is open' })
    }

    const requestId = `mcp-${Date.now()}-${++mcpRequestSequence}`
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        mcpBridgePending.delete(requestId)
        const queuedIndex = mcpBridgeQueue.indexOf(requestId)
        if (queuedIndex >= 0) mcpBridgeQueue.splice(queuedIndex, 1)
        resolve({ ok: false, code: 'BUSY', message: 'Storyboarder did not answer the MCP request in time' })
      }, Math.max(1000, Math.min(Number(timeoutMs) || 30000, 10 * 60 * 1000)))

      const message = {
        requestId,
        operation,
        payload
      }
      mcpBridgePending.set(requestId, { resolve, timer, message })
      if (mcpRendererReady) mainWindow.webContents.send('mcp:request', message)
      else mcpBridgeQueue.push(requestId)
    })
  }
})

const flushMcpBridgeQueue = () => {
  if (!mcpRendererReady || !mainWindow || mainWindow.isDestroyed()) return
  while (mcpBridgeQueue.length) {
    const requestId = mcpBridgeQueue.shift()
    const pending = mcpBridgePending.get(requestId)
    if (pending) mainWindow.webContents.send('mcp:request', pending.message)
  }
}

const startMcpService = async () => {
  if (!mcpService) {
    mcpService = new StoryboarderMcpService({
      bridge: createMcpBridge(),
      appVersion: pkg.version,
      logger: log
    })
  }
  return mcpService.start()
}

const stopMcpService = async () => {
  if (!mcpService) return
  await mcpService.stop()
  for (const [requestId, pending] of mcpBridgePending) {
    clearTimeout(pending.timer)
    pending.resolve({ ok: false, code: 'BUSY', message: 'MCP service stopped' })
    mcpBridgePending.delete(requestId)
  }
  mcpBridgeQueue.splice(0, mcpBridgeQueue.length)
}

const mcpStatusForRenderer = () => {
  const info = mcpService ? mcpService.getInfo() : { enabled: false, host: '127.0.0.1', port: null, endpoint: null, token: null }
  return {
    enabled: Boolean(info.enabled),
    endpoint: info.endpoint,
    token: info.token,
    host: info.host,
    port: info.port
  }
}

const normalizeAspectRatio = value => {
  const ratio = Number(value)
  return Number.isFinite(ratio) && ratio >= 0.1 && ratio <= 10 ? ratio : null
}

const normalizePrefsChange = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = Object.create(null)
  for (const [key, item] of Object.entries(value).slice(0, 256)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)) continue
    if (item === null || typeof item === 'boolean') {
      result[key] = item
    } else if (typeof item === 'number' && Number.isFinite(item)) {
      result[key] = item
    } else if (typeof item === 'string' && item.length <= 4096) {
      result[key] = item
    }
  }
  return result
}

const isSafeLanguageCode = value =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  /^[A-Za-z0-9_-]+$/.test(value)

const readLocaleData = languageCode => {
  if (!isSafeLanguageCode(languageCode)) return null
  try {
    const builtInLanguages = Array.isArray(languageSettings.getSettingByKey('builtInLanguages'))
      ? languageSettings.getSettingByKey('builtInLanguages')
      : []
    const isBuiltIn = builtInLanguages.some(item => item && item.fileName === languageCode)
    const localeRoot = isBuiltIn
      ? path.join(app.getAppPath(), 'src', 'js', 'locales')
      : path.join(app.getPath('userData'), 'locales')
    const filepath = resolveInside(localeRoot, `${languageCode}.json`)
    const data = JSON.parse(readFileUtf8Bounded(filepath, 1024 * 1024))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch (err) {
    log.warn(`Could not load locale ${languageCode}: ${err.message}`)
    return null
  }
}

const valueAtTranslationKey = (data, key) => {
  let value = data
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return undefined
    value = value[part]
  }
  return typeof value === 'string' && value.length <= 4096 ? value : undefined
}

const translationsForKeys = keys => {
  const selected = languageSettings.getSettingByKey('selectedLanguage')
  const selectedData = readLocaleData(isSafeLanguageCode(selected) ? selected : 'en-US') || {}
  const fallbackData = selected === 'en-US' ? selectedData : (readLocaleData('en-US') || {})
  const translations = {}
  for (const key of keys.slice(0, 100)) {
    const value = valueAtTranslationKey(selectedData, key) || valueAtTranslationKey(fallbackData, key)
    if (value !== undefined) translations[key] = value
  }
  return translations
}

const allTranslationKeys = (data, prefix = '', output = [], depth = 0) => {
  if (!data || typeof data !== 'object' || depth > 8 || output.length >= 10000) return output
  for (const [key, value] of Object.entries(data)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') output.push(fullKey)
    else allTranslationKeys(value, fullKey, output, depth + 1)
    if (output.length >= 10000) break
  }
  return output
}

const NEW_WINDOW_TRANSLATION_KEYS = [
  'new-window.creation-title',
  'new-window.script-based-title',
  'new-window.script-based-description',
  'new-window.blank-title',
  'new-window.blank-description',
  'new-window.new-script',
  'new-window.new-blank',
  'new-window.aspect-title',
  'new-window.aspect-ultrawide',
  'new-window.aspect-doublewide',
  'new-window.aspect-wide',
  'new-window.aspect-hd',
  'new-window.aspect-vertical-hd',
  'new-window.aspect-square',
  'new-window.aspect-old',
  'new-window.aspect-description'
]

const WELCOME_TRANSLATION_KEYS = [
  'welcome-window.recentStoryboards',
  'menu.help.getting-started',
  'welcome-window.new-storyboard',
  'menu.file.open',
  'welcome-window.welcome-line-1',
  'welcome-window.welcome-line-2',
  'welcome-window.welcome-line-3'
]

const PREFERENCES_TRANSLATION_KEYS = [
  'preferences.title',
  'preferences.restart-hint',
  'preferences.show-tooltips',
  'preferences.save-automatically',
  'preferences.saving-hint',
  'preferences.force-psd-reload',
  'preferences.psd-reload-hint',
  'preferences.default-timing',
  'preferences.external-psd-editor',
  'preferences.psd-editor-hint',
  'preferences.reveal-keymap-file',
  'preferences.reveal-keymap-file-hint',
  'preferences.show-diagnostics',
  'preferences.show-diagnostics-hint',
  'preferences.line-delay',
  'preferences.line-delay-hint',
  'preferences.notifications',
  'preferences.show-notifications',
  'preferences.aspirational-message',
  'preferences.notifications-line-mileage',
  'preferences.sounds',
  'preferences.sounds-hint',
  'preferences.drawing-sound-effect',
  'preferences.drawing-melodies',
  'preferences.ui-sound-effect',
  'preferences.enable-high-quality-audio',
  'preferences.performance-enhancements',
  'preferences.performance-enhancements-hint',
  'preferences.high-quality-drawing-engine',
  'preferences.high-quality-drawing-engine-hint',
  'preferences.languages',
  'preferences.languages-hint',
  'preferences.open-language-editor',
  'preferences.sign-out',
  'preferences.sign-out-hint',
  'preferences.thanks-for-support',
  'preferences.additional-features-for-support',
  'preferences.add-watermark',
  'preferences.custom-watermark',
  'preferences.enable-mcp',
  'preferences.mcp-hint',
  'preferences.mcp-disabled',
  'preferences.mcp-listening',
  'preferences.mcp-token',
  'preferences.mcp-copy-config',
  'preferences.mcp-config-copied'
]

const PREFERENCES_BOOLEAN_KEYS = new Set([
  'enableTooltips',
  'enableAutoSave',
  'enableForcePsdReloadOnFocus',
  'enableDiagnostics',
  'enableNotifications',
  'enableAspirationalMessages',
  'allowNotificationsForLineMileage',
  'enableDrawingSoundEffects',
  'enableDrawingMelodySoundEffects',
  'enableUISoundEffects',
  'enableHighQualityAudio',
  'enableHighQualityDrawingEngine',
  'enableCanvasPaintingOpacity',
  'enableBrushCursor',
  'enableStabilizer',
  'enableWatermark',
  'enableMcp'
])

const PREFERENCES_RENDERER_KEYS = [
  ...PREFERENCES_BOOLEAN_KEYS,
  'defaultBoardTiming',
  'straightLineDelayInMsecs',
  'absolutePathToImageEditor',
  'userWatermark'
]

const normalizeLanguageList = () => {
  const builtIn = Array.isArray(languageSettings.getSettingByKey('builtInLanguages'))
    ? languageSettings.getSettingByKey('builtInLanguages')
    : []
  const custom = Array.isArray(languageSettings.getSettingByKey('customLanguages'))
    ? languageSettings.getSettingByKey('customLanguages')
    : []
  const seen = new Set()
  return [...builtIn, ...custom].slice(0, 1000).flatMap(item => {
    if (!item || !isSafeLanguageCode(item.fileName) || seen.has(item.fileName)) return []
    const displayName = typeof item.displayName === 'string' && item.displayName.length <= 256
      ? item.displayName
      : item.fileName
    seen.add(item.fileName)
    return [{ fileName: item.fileName, displayName }]
  })
}

const preferencesDataForRenderer = () => {
  languageSettings._loadFile()
  const currentPrefs = prefModule.getPrefs('isolated preferences window')
  const rendererPrefs = {}
  for (const key of PREFERENCES_RENDERER_KEYS) {
    const value = currentPrefs[key]
    if (value === undefined || value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 4096)) {
      rendererPrefs[key] = value
    }
  }

  let accountEmail = null
  try {
    const token = currentPrefs.auth && currentPrefs.auth.token
    const decoded = typeof token === 'string' ? JWT.decode(token) : null
    const email = decoded && decoded.user && decoded.user.email
    if (typeof email === 'string' && email.length <= 320) accountEmail = email
    else if (decoded) accountEmail = 'account'
  } catch (err) {
    accountEmail = null
  }

  let watermarkExists = false
  try {
    watermarkExists = pathExists(resolveForWriteInside(app.getPath('userData'), 'watermark.png'))
  } catch (err) {
    watermarkExists = false
  }

  const languages = normalizeLanguageList()
  const selected = languageSettings.getSettingByKey('selectedLanguage')
  const selectedLanguage = languages.some(item => item.fileName === selected)
    ? selected
    : (languages[0] ? languages[0].fileName : 'en-US')

  return {
    prefs: rendererPrefs,
    translations: translationsForKeys(PREFERENCES_TRANSLATION_KEYS),
    languages,
    selectedLanguage,
    licensed: Boolean(store.getState().license && store.getState().license.iss),
    accountEmail,
    watermarkExists
  }
}

const isLanguagePreferencesWindowSender = event =>
  isWindowSender(event, [LanguagePreferencesWindow && LanguagePreferencesWindow.getWindow && LanguagePreferencesWindow.getWindow()])

const languageInfo = fileName => normalizeLanguageList().find(item => item.fileName === fileName)
const languageIsBuiltIn = fileName => {
  const builtIn = Array.isArray(languageSettings.getSettingByKey('builtInLanguages'))
    ? languageSettings.getSettingByKey('builtInLanguages')
    : []
  return builtIn.some(item => item && item.fileName === fileName)
}

const languageFilePath = fileName => {
  if (!isSafeLanguageCode(fileName) || !languageInfo(fileName)) throw new Error('Unknown language')
  const root = languageIsBuiltIn(fileName)
    ? path.join(app.getAppPath(), 'src', 'js', 'locales')
    : path.join(app.getPath('userData'), 'locales')
  return resolveInside(root, `${fileName}.json`)
}

const normalizeLanguageJson = (value, displayName) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Language data must be an object')
  const sanitized = sanitizeJsonValue(value, {
    maxDepth: 16,
    maxEntries: 100000,
    maxArrayLength: 10000,
    maxStringLength: 1024 * 1024
  })
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) throw new Error('Invalid language data')
  const name = typeof displayName === 'string' && displayName.trim().length > 0
    ? displayName.trim().slice(0, 256)
    : 'Language'
  sanitized.Name = name
  const serialized = JSON.stringify(sanitized)
  if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) throw new Error('Language file is too large')
  return { data: sanitized, serialized, displayName: name }
}

const languageDataForRenderer = fileName => {
  const info = languageInfo(fileName)
  if (!info) throw new Error('Unknown language')
  let data = {}
  try {
    data = JSON.parse(readFileUtf8Bounded(languageFilePath(fileName), 1024 * 1024))
  } catch (err) {
    log.warn(`Could not load language ${fileName}: ${err.message}`)
  }
  return normalizeLanguageJson(data, info.displayName).data
}

const languagePreferencesDataForRenderer = fileName => {
  languageSettings._loadFile()
  const languages = normalizeLanguageList()
  const selectedSetting = isSafeLanguageCode(fileName)
    ? fileName
    : languageSettings.getSettingByKey('selectedLanguage')
  const selectedLanguage = languages.some(item => item.fileName === selectedSetting)
    ? selectedSetting
    : (languages[0] && languages[0].fileName)
  return {
    languages: languages.map(item => ({ ...item, builtIn: languageIsBuiltIn(item.fileName) })),
    selectedLanguage,
    json: selectedLanguage ? languageDataForRenderer(selectedLanguage) : { Name: 'Language' }
  }
}

const writeCustomLanguage = (displayName, value) => {
  const normalized = normalizeLanguageJson(value, displayName)
  const localesRoot = resolveForWriteInside(app.getPath('userData'), 'locales')
  fs.ensureDirSync(localesRoot)
  let fileName
  do {
    const random = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    fileName = `${random}_${safeFilename(normalized.displayName, 'language')}`.replace(/[^A-Za-z0-9_-]/g, '-')
  } while (languageInfo(fileName))
  const filepath = resolveForWriteInside(localesRoot, `${fileName}.json`)
  fs.writeFileSync(filepath, normalized.serialized, 'utf8')
  const customLanguages = (Array.isArray(languageSettings.getSettingByKey('customLanguages'))
    ? languageSettings.getSettingByKey('customLanguages')
    : []).filter(item => item && isSafeLanguageCode(item.fileName))
  customLanguages.push({ fileName, displayName: normalized.displayName })
  languageSettings.setSettings({ selectedLanguage: fileName, customLanguages })
  notifyAllsWindows('languageAdded', fileName)
  return fileName
}

// Microphone access is granted only after the main window explicitly starts
// the recording flow.  The short expiry prevents background pages or stale
// requests from obtaining a persistent permission grant.
const mediaPermissionExpiry = new WeakMap()
const isAudioMediaRequest = (permission, details) => permission === 'media' &&
  (!details || !Array.isArray(details.mediaTypes) ||
    (details.mediaTypes.includes('audio') && !details.mediaTypes.includes('video')))

const protectWindowNavigation = win => {
  if (!win || !win.webContents) return
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-redirect', event => event.preventDefault())
}

// Register the custom scheme before app readiness.  It is deliberately
// privileged only for secure/fetchable resource loading; no JavaScript or
// arbitrary file access is granted by the scheme itself.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'storyboarder-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false
    }
  }
])

const ALLOWED_MEDIA_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.m4a', 'audio/mp4'],
  ['.psd', 'application/octet-stream']
])

const registerMediaProtocol = () => {
  protocol.handle('storyboarder-media', async request => {
    try {
      // The current project is the only project addressable by this process.
      // A future multi-project implementation can replace `current` with a
      // validated project id without weakening the containment check.
      const requestUrl = new URL(request.url)
      if (requestUrl.hostname !== 'current' || requestUrl.search || requestUrl.hash || !currentFile) {
        return new Response('Not found', { status: 404 })
      }

      const relativePath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ''))
      assertSafeRelativePath(relativePath)
      const extension = path.extname(relativePath).toLowerCase()
      const contentType = ALLOWED_MEDIA_TYPES.get(extension)
      if (!contentType) return new Response('Unsupported media type', { status: 415 })

      const segments = relativePath.split(/[\\/]+/)
      const imagesIndex = segments.map(segment => segment.toLowerCase()).lastIndexOf('images')
      if (imagesIndex < 0 || imagesIndex === segments.length - 1) {
        return new Response('Not found', { status: 404 })
      }
      const imagesRoot = path.join(path.dirname(currentFile), ...segments.slice(0, imagesIndex + 1))
      const projectRoot = path.dirname(currentFile)
      const allowedMediaRoots = [path.join(projectRoot, 'images')]
      if (currentPath && typeof currentPath === 'string') {
        try {
          const candidateRoot = path.resolve(currentPath)
          if (isPathInside(projectRoot, candidateRoot)) allowedMediaRoots.push(candidateRoot)
        } catch (err) {
          // Ignore malformed state and keep the standalone-project root.
        }
      }
      if (!allowedMediaRoots.some(root => isPathInside(root, imagesRoot))) {
        return new Response('Not found', { status: 404 })
      }
      const mediaPath = resolveInside(imagesRoot, segments.slice(imagesIndex + 1).join(path.sep))
      const stat = await fs.promises.stat(mediaPath)
      if (!stat.isFile() || stat.size > 100 * 1024 * 1024) {
        return new Response('Media file is unavailable', { status: 404 })
      }

      const data = await fs.promises.readFile(mediaPath)
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        }
      })
    } catch (err) {
      log.warn('Rejected storyboarder-media request')
      return new Response('Not found', { status: 404 })
    }
  })
}

const isTrustedAppUrl = value => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'file:') return false
    // Query/hash fragments are used by the loading window for a display-only
    // project name; they do not change the local file being loaded.
    parsed.search = ''
    parsed.hash = ''
    const filePath = require('url').fileURLToPath(parsed)
    const appRoot = path.resolve(app.getAppPath())
    const resolved = path.resolve(filePath)
    // Windows file URLs are case-insensitive.  Comparing the raw strings
    // would reject a legitimate navigation when the drive or an unpacked
    // directory differs only in casing.  `path.relative` also avoids the
    // prefix-confusion bug where `/app-evil` starts with `/app`.
    const comparisonRoot = process.platform === 'win32' ? appRoot.toLowerCase() : appRoot
    const comparisonPath = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const relative = path.relative(comparisonRoot, comparisonPath)
    return relative === '' || (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  } catch (err) {
    return false
  }
}

// Apply a deny-by-default policy to every renderer, including legacy windows
// that still use Node integration while they are being migrated.  Individual
// windows may add stricter handlers, but none can accidentally loosen this
// boundary.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url || contents.getURL())) event.preventDefault()
  })
  contents.on('will-redirect', event => event.preventDefault())
  contents.on('will-attach-webview', event => event.preventDefault())

  const rendererSession = contents.session
  rendererSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowedUntil = mediaPermissionExpiry.get(webContents) || 0
    const isMainWindowAudioRequest = isAudioMediaRequest(permission, details) &&
      mainWindow && !mainWindow.isDestroyed() &&
      webContents === mainWindow.webContents &&
      allowedUntil > Date.now()
    callback(Boolean(isMainWindowAudioRequest))
  })
  if (rendererSession.setPermissionCheckHandler) {
    rendererSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      const allowedUntil = mediaPermissionExpiry.get(webContents) || 0
      return Boolean(
        isAudioMediaRequest(permission, details) &&
        mainWindow && !mainWindow.isDestroyed() &&
        webContents === mainWindow.webContents &&
        allowedUntil > Date.now()
      )
    })
  }
})

// attempt to support older GPUs
app.commandLine.appendSwitch('ignore-gpu-blacklist')
// this only works on mac.
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (app.isReady()) {
    openFile(path)
  } else {
    toBeOpenedPath = path
  }
})

const syncLanguages = (dir, isLanguageFile, array) => {
  let files
  try {
    files = fileSystem.readdirSync(dir)
  } catch (err) {
    log.warn('Could not scan language directory', err.message)
    return
  }
  for(let i = 0; i < files.length; i++) {
    let fileName = files[i]
    let { name, ext } = path.parse(fileName)
    
    if(isLanguageFile(name, ext)) { 
      try {
        let data = fs.readFileSync(path.join(dir, fileName), 'utf8')
        let json = JSON.parse(data)
        if (!json || typeof json !== 'object' || Array.isArray(json)) continue
        let language = {}
        language.fileName = name
        language.displayName = typeof json.Name === 'string' && json.Name.length <= 256
          ? json.Name
          : name
        array.push(language)
      } catch (err) {
        log.warn('Skipping malformed language file', fileName, err.message)
      }
    }
  }
}

app.on('ready', async () => {
  registerMediaProtocol()
  const exporterFfmpeg = require('./exporters/ffmpeg')
  let ffmpegVersion = await exporterFfmpeg.checkVersion()
  log.info('ffmpeg version', ffmpegVersion)
  
  // Initial set up of language-settings file
  let settings = {builtInLanguages:[], customLanguages:[]}
  let dir = path.join(__dirname, "locales")
  syncLanguages(dir, (name, ext) => ext === ".json", settings.builtInLanguages)
  dir = path.join(app.getPath('userData'), "locales")
  syncLanguages(dir, (name, ext) => ext === ".json" && name !== "language-settings", settings.customLanguages)
  if(Object.keys(languageSettings.getSettings()).length === 0) {
    let appLocale = app.getLocale()
    if(!settings.builtInLanguages.some((item) => item.fileName === app.getLocale())) {
      appLocale = 'en-US'
    }
    settings.selectedLanguage = appLocale
    settings.defaultLanguage = 'en-US'
  } else {
    let selectedLanguage = languageSettings.getSettingByKey("selectedLanguage")
    if(!settings.builtInLanguages.some((item) => item.fileName === selectedLanguage) &&
    !settings.customLanguages.some((item) => item.fileName === selectedLanguage)) {
    settings.selectedLanguage = languageSettings.getSettingByKey("defaultLanguage")
}
  }



  languageSettings.setSettings(settings)
  //TODO(): Check if files of custom languages exist



  // load key map
  const keymapPath = path.join(app.getPath('userData'), 'keymap.json')
  let payload = {}
  let shouldOverwrite = false

  if (fs.existsSync(keymapPath)) {
    log.info('Reading', keymapPath)
    try {
      const parsedKeymap = JSON.parse(readFileUtf8Bounded(keymapPath, 1024 * 1024))
      if (!parsedKeymap || typeof parsedKeymap !== 'object' || Array.isArray(parsedKeymap)) {
        throw new Error('Keymap must be an object')
      }
      payload = {}
      for (const [key, value] of Object.entries(parsedKeymap).slice(0, 1000)) {
        if (
          key !== '__proto__' && key !== 'prototype' && key !== 'constructor' &&
          key.length > 0 && key.length <= 256 && typeof value === 'string' && value.length <= 256
        ) {
          payload[key] = value
        }
      }

      // detect and migrate Storyboarder 1.5.x keymap
      if (
        payload["menu:tools:pencil"] === "2" &&
        payload["menu:tools:pen"] === "3" &&
        payload["menu:tools:brush"] === "4" &&
        payload["menu:tools:note-pen"] === "5" &&
        payload["menu:tools:eraser"] === "6"
      ) {
        log.info('Detected a Storyboarder 1.5.x keymap. Forcing update to menu:tools:*.')
        // force defaults override
        delete payload["menu:tools:pencil"]
        delete payload["menu:tools:pen"]
        delete payload["menu:tools:brush"]
        delete payload["menu:tools:note-pen"]
        delete payload["menu:tools:eraser"]
        shouldOverwrite = true
      }

      // re-map 1.7.1's Shift to Space
      if (payload["drawing:pan-mode"] === "Shift") {
        log.info('[keymap] re-mapping drawing:pan-mode to space')
        payload["drawing:pan-mode"] = "Space"
        shouldOverwrite = true
      }

    } catch (err) {
      // show error, but don't overwrite the keymap file
      log.error(err)
      dialog.showMessageBox({
        type: 'error',
        message: `Whoops! An error ocurred while trying to read ${keymapPath}.\nUsing default keymap instead.\n\n${err}`
      })
    }
  } else {
    // create new keymap.json
    shouldOverwrite = true
  }


  // merge with defaults
  store.dispatch({
    type: 'SET_KEYMAP',
    payload
  })

  // what changed?
  let a = payload
  let b = store.getState().entities.keymap
  let keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (let key of keys) {
    if (a[key] !== b[key]) {
      log.info(key, 'changed from', a[key], 'to', b[key])
      shouldOverwrite = true
    }
  }

  if (shouldOverwrite) {
    log.info('Writing', keymapPath)
    fs.writeFileSync(keymapPath, JSON.stringify(store.getState().entities.keymap, null, 2) + '\n')
  }



  if (os.platform() === 'darwin') {
    if (!isDev && !app.isInApplicationsFolder()) {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'Move to Applications folder?',
        message: 'Would you like to move Storyboarder to the Applications folder?',
        buttons: ['Move to Applications', 'Do Not Move'],
        defaultId: 1
      })

      const yes = (response === 0)

      if (yes) {
        try {
          let didMove = app.moveToApplicationsFolder()
          if (!didMove) {
            dialog.showMessageBox(null, {
              type: 'error',
              message: 'Could not move to Applications folder'
            })
          }
        } catch (err) {
          dialog.showMessageBox(null, {
            type: 'error',
            message: err.message
          })
        }
      }
    }
  }

  await attemptLicenseVerification()



  // setup the menu
  const menuI18n = require('./services/i18next.config')
  await menuI18n.ready
  await menuI18n.changeLanguage(languageSettings.getSettingByKey('selectedLanguage') || 'en-US')
  createMenu({
    store,
    send: (event, ...rest) => menuBus.emit(event, event, ...rest)
  })

  if (prefModule.getPrefs('mcp startup').enableMcp === true) {
    startMcpService()
      .then(status => log.info('Storyboarder MCP service listening at', status.endpoint))
      .catch(err => log.warn('Could not start Storyboarder MCP service', err.message))
  }



  // open the welcome window when the app loads up first
  openWelcomeWindow()

  // TODO why is loading via arg limited to dev mode only?
  // was an argument passed?
  if (isDev) {
    // via https://github.com/electron/electron/issues/4690#issuecomment-217435222
    const argv = process.defaultApp ? process.argv.slice(2) : process.argv

    if (argv[0]) {
      let filePath = path.resolve(argv[0])
      if (fs.existsSync(filePath)) {

        // wait 300 msecs for windows to load
        setTimeout(() => openFile(filePath), 300)

        // prevent welcomeWindow from popping up
        welcomeWindow.hide()
        welcomeWindow.removeAllListeners('ready-to-show')
        return

      } else {
        log.error('Could not load', filePath)
        dialog.showErrorBox(
          'Could not load requested file',
          `Error loading ${filePath}`
        )
      }
    }
  }

  // this only works on mac.
  if (toBeOpenedPath) {
    openFile(toBeOpenedPath)
    return
  }

})

let openKeyCommandWindow = () => {
  if (keyCommandWindow) {
    keyCommandWindow.focus()
    return
  }

  keyCommandWindow = new BrowserWindow({
    width: 1158,
    height: 925,
    maximizable: false,
    center: true,
    show: false,
    resizable: false,
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      webSecurity: true,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload', 'key-command.js')
    }
  })
  protectWindowNavigation(keyCommandWindow)
  keyCommandWindow.loadURL(`file://${__dirname}/../keycommand-window.html`)
  keyCommandWindow.once('ready-to-show', () => {
    setTimeout(() => keyCommandWindow.show(), 250) // wait for DOM
  })
  keyCommandWindow.on('close', () => {
    keyCommandWindow = null
  })
}

app.on('activate', ()=> {
  if (!mainWindow && !welcomeWindow) openWelcomeWindow()
})

let openNewWindow = () => {
  // reset state
  currentFile = undefined
  currentFileLastModified = undefined
  currentPath = undefined
  currentScriptDataObject = undefined

  if (!newWindow) {
    // TODO this code is never called currently, as the window is created w/ welcome
    newWindow = new BrowserWindow({
      width: 600,
      height: 580,
      show: false,
      center: true,
      parent: welcomeWindow,
      resizable: false,
      frame: false,
      modal: true,
      webPreferences: {
        nodeIntegration: false,
        webSecurity: true,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload', 'new-window.js')
      }
    })
    protectWindowNavigation(newWindow)
    newWindow.loadURL(`file://${__dirname}/../new.html`)
    newWindow.once('ready-to-show', () => {
      newWindow.show()
    })
  } else {
    // ensure we clear the tabs
    newWindow.reload()
    setTimeout(() => {
      newWindow.show()
    }, 200)
  }
}

let openWelcomeWindow = () => {
  welcomeWindow = new BrowserWindow({
    width: 900,
    height: 600,
    center: true,
    show: false,
    resizable: false,
    frame: false,
    webPreferences: {
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload', 'welcome.js')
    }
  })
  protectWindowNavigation(welcomeWindow)
  welcomeWindow.loadURL(`file://${__dirname}/../welcome.html`)

  newWindow = new BrowserWindow({
    width: 640,
    height: 580,
    show: false,
    parent: welcomeWindow,
    resizable: false,
    frame: false,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      webSecurity: true,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload', 'new-window.js')
    }
  })
  protectWindowNavigation(newWindow)
  newWindow.loadURL(`file://${__dirname}/../new.html`)

  let recentDocumentsCopy
  if (prefs.recentDocuments) {
    let count = 0
    recentDocumentsCopy = prefs.recentDocuments
    for (var recentDocument of prefs.recentDocuments) {
      try {
        fs.accessSync(recentDocument.filename, fs.R_OK)
      } catch (e) {
        // It isn't accessible
        // log.warn('Recent file no longer exists: ', recentDocument.filename)
        recentDocumentsCopy.splice(count, 1)
      }
      count++
    }
    prefs.recentDocuments = recentDocumentsCopy

    prefModule.set('recentDocuments', recentDocumentsCopy)
  }

  welcomeWindow.once('ready-to-show', () => {
    setTimeout(() => {
      welcomeWindow.show()
      if (!isDev) autoUpdater.init()
      }, 300)

  })

  welcomeWindow.once('close', () => {
    welcomeWindow = null
    if (!welcomeInprogress) {
      app.quit()
    } else {
      welcomeInprogress = false
    }
  })
}

let openFile = filepath => {
  if (
    typeof filepath !== 'string' ||
    filepath.length === 0 ||
    filepath.length > 4096 ||
    filepath.includes('\0') ||
    !path.isAbsolute(filepath)
  ) {
    log.warn('Rejected invalid project path')
    return
  }
  try {
    filepath = assertReadableFile(filepath, MAX_PROJECT_INPUT_SIZE)
  } catch (err) {
    dialog.showMessageBox({
      type: 'error',
      message: /size limit/i.test(err.message)
        ? 'The selected project file is too large.'
        : 'Could not access the selected project file.'
    })
    return
  }
  let filename = path.basename(filepath)
  let extname = path.extname(filepath)

  if (extname === '.storyboarder') {
    /// LOAD STORYBOARDER FILE
    currentFile = filepath
    addToRecentDocs(filepath, {
      boards: 2,
      time: 3000,
    })
    loadStoryboarderWindow(filepath)

  } else if (extname === '.fdx') {
    fs.readFile(filepath, 'utf-8', (err, data) => {
      if (err) {
        dialog.showMessageBox({
          type: 'error',
          message: 'Could not open Final Draft file.\n' + (err && err.message ? err.message : 'File could not be read'),
        })
        return
      }
      let parser = new xml2js.Parser()
      parser.parseString(data, (err, fdxObj) => {
        if (err) {
          dialog.showMessageBox({
            type: 'error',
            message: 'Could not parse Final Draft XML.\n' + (err && err.message ? err.message : 'Invalid XML'),
          })
          return
        }

        currentFile = filepath
        currentPath = path.join(path.dirname(currentFile), 'storyboards')

        try {
          let [scriptData, locations, characters, metadata] = processFdxData(fdxObj)

          findOrCreateProjectFolder([
            scriptData,
            locations,
            characters,
            metadata
          ])
        } catch (error) {
          log.error(error)
          dialog.showMessageBox({
            type: 'error',
            message: 'Could not parse Final Draft data.\n' + error.message
          })
        }
      })
    })

  } else if (extname == '.fountain') {
    currentFile = filepath
    currentPath = path.join(path.dirname(currentFile), 'storyboards')

    fs.readFile(filepath, 'utf-8', (err, data) => {
      if (err) {
        dialog.showMessageBox({
          type: 'error',
          message: 'Could not read Fountain script.\n' + err.message,
        })
        return
      }
      try {
        data = ensureFountainSceneIds(filepath, data)
        findOrCreateProjectFolder(
          processFountainData(data, true, false)
        )
      } catch (error) {
        log.error(error)
        dialog.showMessageBox({
          type: 'error',
          message: 'Could not parse Fountain script.\n' + error.message,
        })
      }
    })
  }
}

const findOrCreateProjectFolder = (scriptDataObject) => {
  if (!Array.isArray(scriptDataObject) || !Array.isArray(scriptDataObject[0]) ||
    scriptDataObject[0].length > 10000 ||
    scriptDataObject.some(value => Array.isArray(value) && value.length > 10000)) {
    dialog.showMessageBox({
      type: 'error',
      message: 'Could not parse script data. The file does not contain valid scenes.'
    })
    return
  }
  try {
    const projectRoot = path.dirname(currentFile)
    currentPath = fs.existsSync(path.join(projectRoot, 'storyboards'))
      ? resolveInside(projectRoot, 'storyboards')
      : resolveForWriteInside(projectRoot, 'storyboards')
  } catch (err) {
    log.warn('Rejected unsafe storyboards directory', err.message)
    dialog.showMessageBox({
      type: 'error',
      message: 'The project storyboards folder points outside the project.'
    })
    return
  }
  // check for storyboard.settings file
  const settingsPathCandidate = path.join(currentPath, 'storyboard.settings')
  if (fs.existsSync(settingsPathCandidate)) {
    // project already exists
    let boardSettings
    try {
      const settingsPath = resolveInside(currentPath, 'storyboard.settings')
      boardSettings = JSON.parse(readFileUtf8Bounded(settingsPath, 10 * 1024 * 1024))
      if (!boardSettings || typeof boardSettings !== 'object' || Array.isArray(boardSettings)) {
        throw new Error('Invalid storyboard settings')
      }
    } catch (err) {
      log.warn('Ignoring invalid storyboard.settings', err.message)
      boardSettings = { lastScene: 0 }
    }
    if (!boardSettings.lastScene) {
      boardSettings.lastScene = 0
    }

    switch (path.extname(currentFile)) {
      case '.fdx':
        // log.info('got existing .fdx project data')
        setWatchedScript()
        addToRecentDocs(currentFile, scriptDataObject[3])
        loadStoryboarderWindow(currentFile, scriptDataObject[0], scriptDataObject[1], scriptDataObject[2], boardSettings, currentPath)
        break
      case '.fountain':
        // log.info('got existing .fountain project data')
        setWatchedScript()
        addToRecentDocs(currentFile, scriptDataObject[3])
        loadStoryboarderWindow(currentFile, scriptDataObject[0], scriptDataObject[1], scriptDataObject[2], boardSettings, currentPath)
        break
    }

  } else {
    // create
    currentScriptDataObject = scriptDataObject
    newWindow.webContents.send('setTab', 1)
    newWindow.show()
    // wait for 'createNew' via ipc, which triggers createAndLoadProject
  }
}

let openDialogue = () => {
  dialog.showOpenDialog({
    title: "Open Script or Storyboarder",
    filters:[
      {
        name: 'Screenplay or Storyboarder',
        extensions: [
          'storyboarder',
          'fountain',
          'fdx'
        ]
      },
    ]}
  ).then(({ filePaths }) => {
    if (filePaths.length) {
      openFile(filePaths[0])
    }
  })
  .catch(err => log.error(err))
}

let importImagesDialogue = (shouldReplace = false) => {
  dialog.showOpenDialog(
    {
      title:"Import Boards",
      filters:[
        {name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'psd']},
      ],
      properties: [
        "openFile",
        ...(
          os.platform() === 'darwin'
            // macOS can select a folder
            ? ["openDirectory"]
            // ... Windows and Linux can’t
            : []
        ),
        ...(
          shouldReplace
            // "replace" only allows a single image
            ? []
            // "import new" allows multiple images
            : ["multiSelections"]
        )
      ]
    }
  ).then(({ filePaths }) => {
    if (filePaths.length) {
      filePaths = filePaths.sort()
      let filepathsRecursive = []
      const maxImportFiles = 10000
      const handleDirectory = (dirPath, depth = 0) => {
        if (depth > 32 || filepathsRecursive.length >= maxImportFiles) return
        let innerFilenames = fs.readdirSync(dirPath)
        for(let innerFilename of innerFilenames) {
          if (filepathsRecursive.length >= maxImportFiles) break
          var innerFilePath = path.join(dirPath, innerFilename)
          let stats = fs.lstatSync(innerFilePath)
          if (stats.isSymbolicLink()) continue
          if(stats.isFile()) {
            filepathsRecursive.push(innerFilePath)
          } else if(stats.isDirectory()) {
            handleDirectory(innerFilePath, depth + 1)
          }
        }
      }
      for(let filepath of filePaths) {
        if (filepathsRecursive.length >= maxImportFiles) break
        let stats = fs.lstatSync(filepath)
        if (stats.isSymbolicLink()) continue
        if(stats.isFile()) {
          filepathsRecursive.push(filepath)
        } else if(stats.isDirectory()) {
          handleDirectory(filepath)
        }
      }

      if (shouldReplace) {
        mainWindow.webContents.send('importImageAndReplace', filepathsRecursive)
      } else {
        mainWindow.webContents.send('insertNewBoardsWithFiles', filepathsRecursive)
      }
    }
  }).catch(err => {
    log.error(err)
  })
}

const processFdxData = fdxObj => {
  try {
    ensureFdxSceneIds(fdxObj)
  } catch (err) {
    throw new Error('Could not add scene ids to Final Draft data.\n' + (err && err.message ? err.message : 'Invalid Final Draft data'))
  }

  let scriptData = importerFinalDraft.importFdxData(fdxObj)

  let locations = importerFinalDraft.getScriptLocations(scriptData)
  let characters = importerFinalDraft.getScriptCharacters(scriptData)

  let metadata = {
    type: 'script',

    // TODO is this metadata needed?
    //
    // sceneBoardsCount: 0,
    // sceneCount: 0,
    // totalMovieTime: 0,

    title: path.basename(currentFile, path.extname(currentFile))
  }

  return [scriptData, locations, characters, metadata]
}

let processFountainData = (data, create, update) => {
  let scriptData = fountain.parse(data, true)
  let locations = fountainDataParser.getLocations(scriptData.tokens)
  let characters = fountainDataParser.getCharacters(scriptData.tokens)
  scriptData = fountainDataParser.parse(scriptData.tokens)
  let metadata = {type: 'script', sceneBoardsCount: 0, sceneCount: 0, totalMovieTime: 0}

  let boardsDirectoryFolders = []
  if (fs.existsSync(currentPath)) {
    currentPath = resolveInside(path.dirname(currentFile), 'storyboards')
    boardsDirectoryFolders = fs.readdirSync(currentPath).filter(file => {
      try {
        const stat = fs.lstatSync(path.join(currentPath, file))
        return stat.isDirectory() && !stat.isSymbolicLink()
      } catch (err) {
        return false
      }
    })
  }

  // fallback title in case one is not provided
  metadata.title = path.basename(currentFile, path.extname(currentFile))

  for (var node of scriptData) {
    switch (node.type) {
      case 'title':
        if (node.text) { metadata.title = node.text.replace(/<(?:.|\n)*?>/gm, '') }
        break
      case 'scene':
        metadata.sceneCount++
        let id
        if (node.scene_id) {
          id = node.scene_id.split('-')
          if (id.length>1) {
            id = id[1]
          } else {
            id = id[0]
          }
        } else {
          id = 'G' + metadata.sceneCount
        }
        for (var directory in boardsDirectoryFolders) {
          if (directory.includes(id)) {
            metadata.sceneBoardsCount++
            // load board file and get stats and shit
            break
          }
        }
        break
    }
  }

  let scenesWithSceneNumbers = scriptData.reduce(
    (coll, node) =>
      (node.type === 'scene' && node.scene_number)
        ? coll + 1
        : coll
  , 0)
  if (scenesWithSceneNumbers === 0) throw new Error('Could not find any numbered scenes in this Fountain script.')

  switch (scriptData[scriptData.length-1].type) {
    case 'section':
      metadata.totalMovieTime = scriptData[scriptData.length-1].time + scriptData[scriptData.length-1].duration
      break
    case 'scene':
      let lastNode = scriptData[scriptData.length-1]['script'][scriptData[scriptData.length-1]['script'].length-1]
      metadata.totalMovieTime = lastNode.time + lastNode.duration
      break
  }

  // unused
  // if (update) {
  //   mainWindow.webContents.send('updateScript', 1)//, diffScene)
  // }

  return [scriptData, locations, characters, metadata]
}

const onScriptFileChange = (eventType, filepath, stats) => {
  if (eventType === 'change') {

    try {
      const expected = fs.realpathSync(currentFile)
      const changed = fs.realpathSync(filepath)
      const changedStat = fs.statSync(changed)
      if (changed !== expected || !changedStat.isFile() || changedStat.size > MAX_PROJECT_INPUT_SIZE) {
        log.warn('Rejected unsafe or oversized watched script update')
        return
      }
    } catch (err) {
      log.warn('Could not validate watched script update')
      return
    }

    // check last modified to determine if we should reload
    let lastModified = fs.statSync(currentFile).mtimeMs
    if (currentFileLastModified && (lastModified === currentFileLastModified)) {
      // file hasn't changed. cancel.
      return
    }
    currentFileLastModified = lastModified

    // load
    let data = readFileUtf8Bounded(filepath, MAX_PROJECT_INPUT_SIZE)

    if (path.extname(filepath) === '.fountain') {
      try {
        // write scene ids for any new scenes
        data = ensureFountainSceneIds(filepath, data)
        let [scriptData, locations, characters, metadata] = processFountainData(data, false, false)
        mainWindow.webContents.send('reloadScript', [scriptData, locations, characters])
      } catch (error) {
        dialog.showMessageBox({
          type: 'error',
          message: 'Could not reload script.\n' + error.message
        })
      }

    } else if (path.extname(filepath) === '.fdx') {
      let parser = new xml2js.Parser()
      parser.parseString(data, (err, fdxObj) => {
        if (err) {
          dialog.showMessageBox({
            type: 'error',
            message: 'Could not parse Final Draft XML.\n' + (err && err.message ? err.message : 'Invalid XML'),
          })
          return
        }

        try {
          ensureFdxSceneIds(fdxObj)
          let [scriptData, locations, characters, metadata] = processFdxData(fdxObj)
          mainWindow.webContents.send('reloadScript', [scriptData, locations, characters])
        } catch (error) {
          dialog.showMessageBox({
            type: 'error',
            message: 'Could not reload script.\n' + error.message
          })
        }
      })
    }
  }
}

const setWatchedScript = () => {
  if (scriptWatcher) { scriptWatcher.close() }

  scriptWatcher = chokidar.watch(currentFile, {
    disableGlobbing: true // treat file strings as literal file names
  })
  scriptWatcher.on('all', onScriptFileChange)
}

const ensureFdxSceneIds = fdxObj => {
  let added = importerFinalDraft.insertSceneIds(fdxObj)

  if (added.length) {
    let builder = new xml2js.Builder({
      xmldec: {
        version: '1.0',
        encoding: 'UTF-8',
        standalone: false
      }
    })
    let xml = builder.buildObject(fdxObj)
    fs.writeFileSync(currentFile, xml)

    dialog.showMessageBox({
      type: 'info',
      message: 'We added scene IDs to the Final Draft script',
      detail: "Scene IDs are what we use to make sure we put the storyboards in the right place. " +
              "If you have your script open in an editor, you should reload it. " +
              "Also, you can change your script around as much as you want, "+
              "but please don't change the scene IDs.",
      buttons: ['OK']
    })
  }
}

const ensureFountainSceneIds = (filePath, data) => {
  let sceneIdScript = fountainSceneIdUtil.insertSceneIds(data)

  if (sceneIdScript[1]) {
    dialog.showMessageBox({
      type: 'info',
      message: 'We added scene IDs to your fountain script.',
      detail: "Scene IDs are what we use to make sure we put the storyboards in the right place. If you have your script open in an editor, you should reload it. Also, you can change your script around as much as you want, but please don't change the scene IDs.",
      buttons: ['OK']
    })

    fs.writeFileSync(filePath, sceneIdScript[0])
    data = sceneIdScript[0]
  }

  return data
}


// unused
// let getSceneDifference = (scriptA, scriptB) => {
//   let i = 0
//   for (var node of scriptB) {
//     if(!scriptA[i]) {
//       return i
//     }
//     if (JSON.stringify(node) !== JSON.stringify(scriptA[i])) {
//       return i
//     }
//     i++
//   }
//   return false
// }


////////////////////////////////////////////////////////////
// new functions
////////////////////////////////////////////////////////////

const createAndLoadScene = async aspectRatio => {
  // if directory exists, showSaveDialog will prompt to confirm overwrite
  let { canceled, filePath } = await dialog.showSaveDialog({
    title: "New Storyboard",
    buttonLabel: "Create",
    defaultPath: app.getPath('documents'),
    options: {
      properties: [
        // show overwrite confirmation on linux (UNTESTED)
        // is `true` the default? not sure …
        "showOverwriteConfirmation"
      ]
    }
  })

  if (canceled) return

  // if the filePath exists ...
  if (fs.existsSync(filePath)) {
    // ... and is a folder ...
    if (fs.lstatSync(filePath).isDirectory()) {
      // ... try to trash it ...
      log.info('\ttrash existing folder', filePath)
      await trash(filePath)
    } else {
      dialog.showMessageBox(null, {
        message: "Could not overwrite file " + path.basename(filePath) + ". Only folders can be overwritten."
      })
      return
    }
  }

  fs.mkdirSync(filePath)

  let boardName = path.basename(filePath)
  let storyboarderFilePath = path.join(filePath, boardName + '.storyboarder')

  let newBoardObject = {
    version: pkg.version,
    aspectRatio: aspectRatio,
    fps: prefModule.getPrefs().lastUsedFps || 24,
    defaultBoardTiming: prefs.defaultBoardTiming,
    boards: []
  }

  fs.writeFileSync(storyboarderFilePath, JSON.stringify(newBoardObject))
  fs.mkdirSync(path.join(filePath, 'images'))

  addToRecentDocs(storyboarderFilePath, newBoardObject)
  loadStoryboarderWindow(storyboarderFilePath)
}

const createAndLoadProject = aspectRatio => {
  currentPath = resolveForWriteInside(path.dirname(currentFile), 'storyboards')
  fs.ensureDirSync(currentPath)

  let boardSettings = {
    lastScene: 0,
    aspectRatio
  }
  fs.writeFileSync(resolveForWriteInside(currentPath, 'storyboard.settings'), JSON.stringify(boardSettings))

  setWatchedScript()
  addToRecentDocs(currentFile, currentScriptDataObject[3])
  loadStoryboarderWindow(currentFile, currentScriptDataObject[0], currentScriptDataObject[1], currentScriptDataObject[2], boardSettings, currentPath)
}

let loadStoryboarderWindow = (filename, scriptData, locations, characters, boardSettings, currentPath) => {
  mcpRendererReady = false
  isLoadingProject = true
  mainWindowPathGrants.clear()
  // The project was selected through the app's open flow. Explicitly grant
  // its directory tree to the isolated renderer before it starts reading the
  // board and media files. This also avoids ambiguity when the project lives
  // below app.getAppPath() in development builds.
  if (typeof filename === 'string' && path.isAbsolute(filename)) {
    grantMainWindowPath(path.dirname(filename), true)
  }
  if (typeof currentPath === 'string' && path.isAbsolute(currentPath)) {
    grantMainWindowPath(currentPath, true)
  }

  if (welcomeWindow) {
    welcomeWindow.hide()
  }
  if (newWindow) {
    newWindow.hide()
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }

  const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    acceptFirstMouse: true,
    backgroundColor: '#333333',

    width: Math.min(width, 2480),
    height: Math.min(height, 1350),

    title: path.basename(filename),

    minWidth: 1024,
    minHeight: 640,
    show: false,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      webgl: true,
      devTools: true,
      preload: path.join(__dirname, 'preload', 'main-window.js'),
      nodeIntegration: false,
      webSecurity: true,
      contextIsolation: true,
      sandbox: true
    }
  })
  protectWindowNavigation(mainWindow)

  let projectName = path.basename(filename, path.extname(filename))
  loadingStatusWindow = new BrowserWindow({
    width: 450,
    height: 150,
    backgroundColor: '#333333',
    show: false,
    frame: false,
    resizable: isDev ? true : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'loading-status.js'),
      nodeIntegration: false,
      webSecurity: true,
      contextIsolation: true,
      sandbox: true
    }
  })
  protectWindowNavigation(loadingStatusWindow)
  loadingStatusWindow.loadURL(`file://${__dirname}/../loading-status.html?name=${encodeURIComponent(projectName)}`)
  loadingStatusWindow.once('ready-to-show', () => {
    loadingStatusWindow.show()
  })


  // http://stackoverflow.com/a/39305399
  // https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onerror
  const onErrorInWindow = (event, message, source, lineno, colno, error) => {
    if (isDev) {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.webContents.openDevTools()
      }
    }
    dialog.showMessageBox({
      title: 'Error',
      type: 'error',
      message: message,
      detail: 'In file: ' + source + '#' + lineno + ':' + colno
    })
    log.error(message, source, lineno, colno)
  }

  ipcMain.on('errorInWindow', (event, message, source, lineno, colno) => {
    if (!isMainWindowSender(event)) return
    const safeMessage = typeof message === 'string' ? message.slice(0, 4096) : 'Renderer error'
    const safeSource = typeof source === 'string' ? source.slice(0, 4096) : ''
    onErrorInWindow(event, safeMessage, safeSource, Number(lineno) || 0, Number(colno) || 0)
  })
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log.error('main-window did-fail-load', errorCode, errorDescription, validatedURL)
  })
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('main-window render-process-gone', details)
  })
  mainWindow.loadURL(`file://${__dirname}/../main-window.html`)
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('load', [filename, scriptData, locations, characters, boardSettings, currentPath])
    isLoadingProject = false
  })

  // TODO could move this to main-window code?
  if (isDev) {
    mainWindow.webContents.on('devtools-focused', event => { mainWindow.webContents.send('devtools-focused') })
    mainWindow.webContents.on('devtools-closed', event => { mainWindow.webContents.send('devtools-closed') })
  }

  // via https://github.com/electron/electron/blob/master/docs/api/web-contents.md#event-will-prevent-unload
  //     https://github.com/electron/electron/pull/9331
  //
  // if beforeunload is telling us to prevent unload ...
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Yes', 'No'],
      title: 'Confirm',
      message: 'Your Storyboarder file is not saved. Are you sure you want to close the workspace?'
    })

    const leave = (choice === 0)

    if (leave) {
      // ignore the default behavior of preventing unload
      // ... which means we'll actually ... _allow_ unload :)
      event.preventDefault()
    }
  })

  mainWindow.once('closed', event => {
    if (welcomeWindow) {
      ipcMain.removeListener('errorInWindow', onErrorInWindow)
      welcomeWindow.webContents.send('updateRecentDocuments')
      // when old workspace is closed,
      //   show the welcome window
      // EXCEPT if we're currently loading a new workspace
      //        (to take old's place)
      if (!isLoadingProject) {
        welcomeWindow.show()
      }

      // stop watching any fountain files
      if (scriptWatcher) { scriptWatcher.close() }

    }
  })
}


let addToRecentDocs = (filename, metadata) => {
  let prefs = prefModule.getPrefs('add to recent')

  let recentDocuments
  if (!prefs.recentDocuments) {
    recentDocuments = []
  } else {
    recentDocuments = prefs.recentDocuments
  }

  let currPos = 0

  for (var document of recentDocuments) {
    if (document.filename == filename) {
      recentDocuments.splice(currPos, 1)
      break
    }
    currPos++
  }

  let recentDocument = metadata

  if (!recentDocument.title) {
    let title = filename.split(path.sep)
    title = title[title.length-1]
    title = title.split('.')
    title.splice(-1,1)
    title = title.join('.')
    recentDocument.title = title
  }

  recentDocument.filename = filename
  recentDocument.time = Date.now()
  recentDocuments.unshift(recentDocument)
  // save
  prefModule.set('recentDocuments', recentDocuments)
}

let attemptLicenseVerification = async () => {
  const nodeFetch = require('node-fetch')
  const { VERIFICATION_URL, checkLicense } = require('./models/license')

  let token
  let license
  let licenseKeyPath

  try {
    licenseKeyPath = resolveForWriteInside(app.getPath('userData'), 'license.key')
    token = fs.readFileSync(assertReadableFile(licenseKeyPath, 256 * 1024), { encoding: 'utf8' })
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.info('No license key found')
      return
    } else {
      log.error('Could not load license.key')
      log.error(err)
      return
    }
  }

  try {
    if (await checkLicense(token, { fetcher: nodeFetch })) {

      log.info('license accepted')

      store.dispatch({
        type: 'SET_LICENSE',
        payload: JWT.decode(token)
      })

    } else {
      dialog.showMessageBox({
        message: 'License key is no longer valid.'
      })
      log.info('Removing invalid license key at', licenseKeyPath)
      prefModule.revokeLicense()
      await trash(licenseKeyPath)
    }
  } catch (err) {
    log.error(err)
    dialog.showMessageBox({
      type: 'error',
      message: `An error occurred while checking the license key.\n\n${err}`
    })
  }
}

////////////////////////////////////////////////////////////
// ipc passthrough
////////////////////////////////////////////////////////////

//////////////////
// Main Window
//////////////////

menuBus.on('newBoard', (e, arg)=> {
  mainWindow.webContents.send('newBoard', arg)
})

menuBus.on('deleteBoards', (e, arg)=> {
  mainWindow.webContents.send('deleteBoards', arg)
})

menuBus.on('duplicateBoard', (e, arg)=> {
  mainWindow.webContents.send('duplicateBoard')
})

menuBus.on('splitBoard', () => {
  mainWindow.webContents.send('splitBoard')
})

menuBus.on('reorderBoardsLeft', (e, arg)=> {
  mainWindow.webContents.send('reorderBoardsLeft')
})

menuBus.on('reorderBoardsRight', (e, arg)=> {
  mainWindow.webContents.send('reorderBoardsRight')
})

menuBus.on('togglePlayback', (e, arg)=> {
  mainWindow.webContents.send('togglePlayback')
})

menuBus.on('openInEditor', (e, arg)=> {
  mainWindow.webContents.send('openInEditor')
})

menuBus.on('goPreviousBoard', (e, arg)=> {
  mainWindow.webContents.send('goPreviousBoard')
})

menuBus.on('goNextBoard', (e, arg)=> {
  mainWindow.webContents.send('goNextBoard')
})

menuBus.on('previousScene', (e, arg)=> {
  mainWindow.webContents.send('previousScene')
})

menuBus.on('nextScene', (e, arg)=> {
  mainWindow.webContents.send('nextScene')
})

menuBus.on('copy', (e, arg)=> {
  mainWindow.webContents.send('copy')
})

menuBus.on('paste', (e, arg)=> {
  mainWindow.webContents.send('paste')
})

menuBus.on('paste-replace', () => {
  mainWindow.webContents.send('paste-replace')
})

/// TOOLS

menuBus.on('undo', (e, arg)=> {
  mainWindow.webContents.send('undo')
})


menuBus.on('redo', (e, arg)=> {
  mainWindow.webContents.send('redo')
})

menuBus.on('setTool', (e, arg) =>
  mainWindow.webContents.send('setTool', arg))

menuBus.on('useColor', (e, arg)=> {
  mainWindow.webContents.send('useColor', arg)
})

menuBus.on('clear', (e, arg) => {
  mainWindow.webContents.send('clear', arg)
})

menuBus.on('brushSize', (e, arg)=> {
  mainWindow.webContents.send('brushSize', arg)
})

menuBus.on('flipBoard', (e, arg)=> {
  mainWindow.webContents.send('flipBoard', arg)
})

/// VIEW

menuBus.on('cycleViewMode', (e, arg)=> {
  mainWindow.webContents.send('cycleViewMode', arg)
})

menuBus.on('toggleCaptions', (e, arg)=> {
  mainWindow.webContents.send('toggleCaptions', arg)
})

menuBus.on('toggleTimeline', () =>
  mainWindow.webContents.send('toggleTimeline'))

//////////////////
// Welcome Window
//////////////////

ipcMain.handle('welcome:getData', event => {
  if (!isWelcomeWindowSender(event)) throw new Error('Unauthorized welcome request')
  const recentDocuments = prefModule.getPrefs('welcome').recentDocuments
  const safeRecent = Array.isArray(recentDocuments)
    ? recentDocuments.slice(0, 100).flatMap(item => {
      if (!item || typeof item !== 'object' || typeof item.filename !== 'string' || item.filename.length > 4096 || item.filename.includes('\0')) return []
      return [{
        filename: item.filename,
        title: typeof item.title === 'string' ? item.title.slice(0, 512) : path.basename(item.filename),
        time: typeof item.time === 'number' && Number.isFinite(item.time) ? item.time : Date.now()
      }]
    })
    : []
  return { version: pkg.version, recentDocuments: safeRecent, translations: translationsForKeys(WELCOME_TRANSLATION_KEYS) }
})

ipcMain.on('welcome:close', event => {
  if (!isWelcomeWindowSender(event)) return
  if (welcomeWindow && !welcomeWindow.isDestroyed()) welcomeWindow.close()
})

ipcMain.handle('welcome:openExternal', (event, value) => {
  if (!isWelcomeWindowSender(event) || !isSafeExternalUrl(value)) return { ok: false, error: 'invalid-url' }
  shell.openExternal(value)
  return { ok: true }
})

ipcMain.on('welcome:setMenu', event => {
  if (!isWelcomeWindowSender(event)) return
  try {
    const i18n = require('./services/i18next.config')
    require('./main/menu').setWelcomeMenu(i18n)
  } catch (err) {
    log.warn('Could not set welcome menu', err.message)
  }
})

ipcMain.on('openFile', (e, arg)=> {
  if (!isKnownAppWindowSender(e)) return
  openFile(arg)
})

const MAIN_WINDOW_APP_PATHS = new Set([
  'appData', 'desktop', 'documents', 'downloads', 'home', 'music', 'pictures',
  'temp', 'userData', 'videos'
])

const mainWindowPathGrants = new Map()

const grantMainWindowPath = (value, tree = false) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) return
  if (mainWindowPathGrants.size >= 128) mainWindowPathGrants.delete(mainWindowPathGrants.keys().next().value)
  mainWindowPathGrants.set(path.resolve(value), { tree: Boolean(tree), readOnly: false })
}

const openAboutExternal = url => {
  if (![projectMetadata.repositoryUrl, projectMetadata.licenseFileUrl, projectMetadata.licenseUrl].includes(url)) return
  shell.openExternal(url).catch(err => {
    log.warn('Could not open external About link', err.message)
  })
}

let openAboutWindow = () => {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show()
    aboutWindow.focus()
    return
  }

  const parent = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : (welcomeWindow && !welcomeWindow.isDestroyed() ? welcomeWindow : undefined)

  aboutWindow = new BrowserWindow({
    width: 620,
    height: 560,
    minWidth: 520,
    minHeight: 480,
    show: false,
    center: true,
    parent,
    resizable: false,
    title: 'About Storyboarder',
    backgroundColor: '#f4f5f7',
    webPreferences: {
      nodeIntegration: false,
      webSecurity: true,
      contextIsolation: true,
      sandbox: true
    }
  })

  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAboutExternal(url)
    return { action: 'deny' }
  })
  aboutWindow.webContents.on('will-navigate', event => {
    const url = event.url
    event.preventDefault()
    openAboutExternal(url)
  })
  aboutWindow.webContents.on('will-redirect', event => event.preventDefault())
  aboutWindow.once('ready-to-show', () => aboutWindow.show())
  aboutWindow.on('closed', () => {
    aboutWindow = null
  })
  aboutWindow.loadFile(path.join(__dirname, '../about.html'))
}

const allowedMainWindowRoots = () => {
  const userData = app.getPath('userData')
  const temp = app.getPath('temp')
  const entries = [
    { root: app.getAppPath(), tree: true, readOnly: true },
    { root: path.join(temp, 'storyboarder-renderer'), tree: true, readOnly: false },
    { root: path.join(temp, 'worksheetoutput.pdf'), tree: false, readOnly: true },
    { root: path.join(userData, 'storyboarder-settings.json'), tree: false, readOnly: false },
    { root: path.join(userData, 'recordings.json'), tree: false, readOnly: false },
    { root: path.join(userData, 'watermark.png'), tree: false, readOnly: true },
    { root: path.join(userData, 'presets'), tree: true, readOnly: false }
  ]
  if (typeof currentFile === 'string' && path.isAbsolute(currentFile)) entries.push({ root: path.dirname(currentFile), tree: true, readOnly: false })
  if (typeof currentPath === 'string' && path.isAbsolute(currentPath)) entries.push({ root: currentPath, tree: true, readOnly: false })
  for (const [root, options] of mainWindowPathGrants) entries.push({ root, ...options })
  const unique = new Map()
  for (const entry of entries) unique.set(path.resolve(entry.root), { ...entry, root: path.resolve(entry.root) })
  return [...unique.values()].sort((left, right) => right.root.length - left.root.length)
}

const validateMainWindowPath = (value, { forWrite = false } = {}) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error('Invalid file path')
  }
  const resolved = path.resolve(value)
  const entry = allowedMainWindowRoots().find(candidate => candidate.tree ? isPathInside(candidate.root, resolved) : candidate.root === resolved)
  if (!entry) throw new Error('File path is outside allowed application locations')
  if (forWrite && entry.readOnly) throw new Error('Application resource paths are read-only')

  let existing = fs.existsSync(resolved) ? resolved : path.dirname(resolved)
  while (!fs.existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing)
  const realExisting = fs.realpathSync(existing)
  // Anchor the canonical path check at the parent of the allow-listed root.
  // Using the root itself would bless a symlinked root (the root and its
  // realpath would be equal) and could let a fixed userData file escape.
  let rootAnchor = path.dirname(entry.root)
  while (!fs.existsSync(rootAnchor) && rootAnchor !== path.dirname(rootAnchor)) rootAnchor = path.dirname(rootAnchor)
  const realRootAnchor = fs.realpathSync(rootAnchor)
  if (!isPathInside(realRootAnchor, realExisting)) {
    throw new Error('File path escapes an allowed location')
  }
  if (!forWrite && fs.existsSync(resolved)) {
    const realResolved = fs.realpathSync(resolved)
    if (entry.tree && fs.existsSync(entry.root)) {
      const realRoot = fs.realpathSync(entry.root)
      if (!isPathInside(realRoot, realResolved)) throw new Error('File symlink escapes an allowed location')
    } else if (!entry.tree && realResolved !== fs.realpathSync(entry.root)) {
      throw new Error('File symlink escapes an allowed location')
    }
    return realResolved
  }
  return resolved
}

const serializeStat = stat => ({
  size: stat.size,
  mtimeMs: stat.mtimeMs,
  ctimeMs: stat.ctimeMs,
  file: stat.isFile(),
  directory: stat.isDirectory(),
  symbolicLink: stat.isSymbolicLink()
})

ipcMain.on('mainWindow:app-path', (event, name) => {
  if (!isMainWindowSender(event)) return
  event.returnValue = name === '__appPath' ? app.getAppPath() : MAIN_WINDOW_APP_PATHS.has(name) ? app.getPath(name) : ''
})

ipcMain.on('mainWindow:app-info', event => {
  if (isMainWindowSender(event)) event.returnValue = app.isPackaged
})

ipcMain.on('mainWindow:prefs-sync', (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || typeof request !== 'object') return
  try {
    if (request.action === 'get') {
      event.returnValue = sanitizeMainWindowPrefs(prefModule.getPrefs(request.section))
    } else if (request.action === 'set' && typeof request.name === 'string' &&
      request.name.length <= 128 && MAIN_WINDOW_PREF_KEYS.has(request.name)) {
      const value = sanitizeJsonValue(request.value, { maxDepth: 8, maxEntries: 5000, maxStringLength: 4096 })
      prefModule.set(request.name, value, request.save !== false)
      event.returnValue = true
    } else if (request.action === 'save') {
      prefModule.savePrefs()
      event.returnValue = true
    }
  } catch (err) {
    log.warn('Rejected main-window preferences operation', err.message)
    event.returnValue = undefined
  }
})

ipcMain.handle('mainWindow:auth', (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || typeof request !== 'object') {
    return { ok: false, authenticated: false, error: 'unauthorized' }
  }
  if (request.action === 'status') {
    const auth = prefModule.getPrefs('main-window auth status').auth
    return { ok: true, authenticated: Boolean(auth && typeof auth.token === 'string' && auth.token.length > 0) }
  }
  if (request.action === 'clear') {
    prefModule.set('auth', undefined, true)
    return { ok: true, authenticated: false }
  }
  return { ok: false, authenticated: false, error: 'invalid-request' }
})

ipcMain.on('mainWindow:window-action', (event, request = {}) => {
  if (!isMainWindowSender(event) || !mainWindow || mainWindow.isDestroyed()) return
  if (request.action === 'is-focused') event.returnValue = mainWindow.isFocused()
  else if (request.action === 'get-bounds') event.returnValue = mainWindow.getBounds()
  else if (request.action === 'show') mainWindow.show()
  else if (request.action === 'hide') mainWindow.hide()
  else if (request.action === 'open-devtools' && isDev) mainWindow.webContents.openDevTools()
  else if (request.action === 'set-zoom-factor') {
    const value = Number(request.value)
    if (Number.isFinite(value) && value >= 0.5 && value <= 3) mainWindow.webContents.setZoomFactor(value)
  }
})

ipcMain.handle('mainWindow:dialog', async (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || typeof request !== 'object') return { canceled: true }
  const supplied = request.options && typeof request.options === 'object' ? request.options : {}
  const options = {}
  if (typeof supplied.title === 'string') options.title = supplied.title.slice(0, 256)
  if (typeof supplied.message === 'string') options.message = supplied.message.slice(0, 8192)
  if (typeof supplied.detail === 'string') options.detail = supplied.detail.slice(0, 8192)
  if (['none', 'info', 'error', 'question', 'warning'].includes(supplied.type)) options.type = supplied.type
  if (Array.isArray(supplied.buttons)) options.buttons = supplied.buttons.slice(0, 8).map(value => String(value).slice(0, 128))
  if (Array.isArray(supplied.properties)) options.properties = supplied.properties.filter(value => ['openFile', 'openDirectory', 'multiSelections', 'createDirectory', 'showHiddenFiles'].includes(value))
  if (Array.isArray(supplied.filters)) options.filters = supplied.filters.slice(0, 16).flatMap(filter => {
    if (!filter || typeof filter.name !== 'string' || !Array.isArray(filter.extensions)) return []
    return [{ name: filter.name.slice(0, 128), extensions: filter.extensions.slice(0, 32).map(value => String(value).replace(/[^A-Za-z0-9*]/g, '').slice(0, 16)).filter(Boolean) }]
  })
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mainWindow:resize')
  })
  if (typeof supplied.defaultPath === 'string') {
    try {
      if (supplied.defaultPath.length > 4096 || supplied.defaultPath.includes('\0') || !path.isAbsolute(supplied.defaultPath)) throw new Error('Invalid default path')
      const resolvedDefault = path.resolve(supplied.defaultPath)
      const defaultRoots = ['desktop', 'documents', 'downloads', 'music', 'pictures', 'videos'].map(name => path.resolve(app.getPath(name)))
      if (!defaultRoots.some(root => isPathInside(root, resolvedDefault)) && !allowedMainWindowRoots().some(entry => entry.tree ? isPathInside(entry.root, resolvedDefault) : entry.root === resolvedDefault)) {
        throw new Error('Default path is outside known locations')
      }
      options.defaultPath = resolvedDefault
    } catch (err) {}
  }
  if (request.action === 'message') return dialog.showMessageBox(mainWindow, options)
  if (request.action === 'open') {
    const result = await dialog.showOpenDialog(mainWindow, options)
    if (!result.canceled) {
      const tree = Array.isArray(options.properties) && options.properties.includes('openDirectory')
      for (const filePath of result.filePaths || []) grantMainWindowPath(filePath, tree)
    }
    return result
  }
  if (request.action === 'save') {
    const result = await dialog.showSaveDialog(mainWindow, options)
    if (!result.canceled && result.filePath) grantMainWindowPath(result.filePath, true)
    return result
  }
  return { canceled: true }
})

ipcMain.handle('mainWindow:window', async (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || typeof request !== 'object') return { ok: false, error: 'unauthorized' }
  try {
    if (request.action === 'open-external') {
      if (!isSafeExternalUrl(request.url)) throw new Error('Invalid external URL')
      await shell.openExternal(request.url)
    } else if (request.action === 'open-path') {
      const filePath = validateMainWindowPath(request.filePath)
      const error = await shell.openPath(filePath)
      return error
    } else if (request.action === 'show-item') {
      shell.showItemInFolder(validateMainWindowPath(request.filePath))
    } else {
      throw new Error('Unsupported window operation')
    }
    return { ok: true }
  } catch (err) {
    log.warn('Rejected main-window shell operation', err.message)
    return { ok: false, error: 'invalid-request' }
  }
})

ipcMain.handle('mainWindow:clipboard-read', (event, request) => {
  if (!isMainWindowSender(event)) return ''
  if (request && request.action === 'image') {
    const image = clipboard.readImage()
    return image.isEmpty() ? '' : image.toDataURL()
  }
  return clipboard.readText().slice(0, 20 * 1024 * 1024)
})

ipcMain.on('mainWindow:clipboard-read-sync', (event, request) => {
  if (!isMainWindowSender(event)) return
  if (request && request.action === 'image') {
    const image = clipboard.readImage()
    event.returnValue = image.isEmpty() ? '' : image.toDataURL()
  } else {
    event.returnValue = clipboard.readText().slice(0, 20 * 1024 * 1024)
  }
})

ipcMain.handle('mainWindow:clipboard-write', (event, payload = {}) => {
  if (!isMainWindowSender(event)) return { ok: false }
  if (payload && payload.clear) {
    clipboard.clear()
    return { ok: true }
  }
  const data = {}
  if (typeof payload.text === 'string') data.text = payload.text.slice(0, 20 * 1024 * 1024)
  const imageDataUrl = payload.image && payload.image.__storyboarderDataUrl
  if (typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image/') && imageDataUrl.length <= 100 * 1024 * 1024) {
    data.image = nativeImage.createFromDataURL(imageDataUrl)
  }
  if (!Object.keys(data).length) return { ok: false }
  clipboard.write(data)
  return { ok: true }
})

ipcMain.on('mainWindow:fs-sync', (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || typeof request !== 'object') return
  try {
    const readPath = value => validateMainWindowPath(value)
    const writePath = value => validateMainWindowPath(value, { forWrite: true })
    switch (request.op) {
      case 'exists': {
        try { event.returnValue = fs.existsSync(readPath(request.path)) } catch (err) { event.returnValue = false }
        break
      }
      case 'stat': event.returnValue = serializeStat(fs.statSync(readPath(request.path))); break
      case 'lstat': event.returnValue = serializeStat(fs.lstatSync(readPath(request.path))); break
      case 'realpath': {
        try {
          event.returnValue = fs.realpathSync(readPath(request.path))
        } catch (err) {
          // Containment helpers need to canonicalize an allowed parent before
          // resolving a child.  Exposing that directory metadata does not
          // expose its contents, so permit only the well-known app-data
          // parents here; reads/writes still require a specific allow-listed
          // file or a user-granted directory.
          const metadataRoots = [app.getPath('appData'), app.getPath('userData'), app.getPath('temp')]
          const candidate = typeof request.path === 'string' ? path.resolve(request.path) : ''
          if (metadataRoots.some(root => path.resolve(root) === candidate) && fs.existsSync(candidate)) {
            event.returnValue = fs.realpathSync(candidate)
          } else {
            throw err
          }
        }
        break
      }
      case 'readdir': event.returnValue = fs.readdirSync(readPath(request.path)).slice(0, 100000); break
      case 'mkdir': fs.mkdirSync(writePath(request.path), { recursive: Boolean(request.options && request.options.recursive) }); event.returnValue = true; break
      case 'emptyDir': {
        const destination = writePath(request.path)
        if (allowedMainWindowRoots().some(root => root.tree && root.root === destination && !mainWindowPathGrants.has(destination))) throw new Error('Cannot empty an allowed root')
        fs.emptyDirSync(destination)
        event.returnValue = true
        break
      }
      case 'read': event.returnValue = fs.readFileSync(assertReadableFile(readPath(request.path), 100 * 1024 * 1024)); break
      case 'write': {
        const data = request.data && request.data.type === 'Buffer' ? Buffer.from(request.data.data) : Buffer.from(request.data || [])
        if (data.length > 100 * 1024 * 1024) throw new Error('Write exceeds size limit')
        fs.ensureDirSync(path.dirname(writePath(request.path)))
        fs.writeFileSync(writePath(request.path), data)
        event.returnValue = true
        break
      }
      case 'copy': fs.copySync(readPath(request.from), writePath(request.to), { overwrite: !request.options || request.options.overwrite !== false }); event.returnValue = true; break
      case 'move': fs.moveSync(readPath(request.from), writePath(request.to), { overwrite: Boolean(request.options && request.options.overwrite) }); event.returnValue = true; break
      case 'remove': {
        const destination = readPath(request.path)
        if (allowedMainWindowRoots().some(root => root.root === destination && !mainWindowPathGrants.has(destination))) throw new Error('Cannot remove an allowed root')
        fs.removeSync(destination)
        event.returnValue = true
        break
      }
      default: throw new Error('Unsupported file operation')
    }
  } catch (err) {
    const rejectedPath = request.path || request.from || request.to || ''
    log.warn('Rejected main-window file operation', request.op, typeof rejectedPath === 'string' ? path.basename(rejectedPath).slice(0, 128) : '', err.message)
    const code = err && typeof err.code === 'string' ? err.code : 'EACCES'
    event.returnValue = {
      __storyboarderError: true,
      code: code.slice(0, 32),
      message: code === 'ENOENT' ? 'File not found' : 'File operation rejected'
    }
  }
})

ipcMain.handle('mainWindow:project', async (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || typeof request !== 'object') return { ok: false, error: 'unauthorized' }
  if (request.action === 'open-upload') {
    if (uploadWindow && !uploadWindow.isDestroyed()) {
      uploadWindow.show()
      uploadWindow.focus()
      return { ok: true }
    }
    uploadWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 600,
      minHeight: 600,
      backgroundColor: '#333333',
      show: false,
      center: true,
      parent: mainWindow,
      resizable: true,
      frame: false,
      modal: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload', 'upload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })
    protectWindowNavigation(uploadWindow)
    uploadWindow.once('ready-to-show', () => uploadWindow && !uploadWindow.isDestroyed() && uploadWindow.show())
    uploadWindow.on('hide', () => sendToMainWindow('textInputMode', false))
    uploadWindow.on('closed', () => { uploadWindow = null })
    await uploadWindow.loadFile(path.join(__dirname, '..', 'upload.html'))
    return { ok: true }
  }
  if (request.action === 'trash') {
    try {
      if (!Array.isArray(request.paths) || request.paths.length > 10000) throw new Error('Invalid trash request')
      const paths = request.paths.map(value => validateMainWindowPath(value))
      await trash(paths)
      return { ok: true }
    } catch (err) {
      log.warn('Rejected main-window trash operation', err.message)
      return { ok: false, error: 'invalid-request' }
    }
  }
  if (request.action !== 'open-editor' || !Array.isArray(request.args) || request.args.length !== 1) return { ok: false, error: 'invalid-request' }
  try {
    const linkedFile = validateMainWindowPath(request.args[0])
    const command = buildEditorCommand(request.command, linkedFile)
    if (!command) throw new Error('Invalid editor command')
    const configuredEditor = prefModule.getPrefs().absolutePathToImageEditor
    if (configuredEditor && path.resolve(configuredEditor) !== path.resolve(command.command) && command.command !== 'open') {
      throw new Error('Editor does not match preferences')
    }
    await new Promise((resolve, reject) => execFile(command.command, command.args, error => error ? reject(error) : resolve()))
    return { ok: true }
  } catch (err) {
    log.warn('Could not open project media in editor', err.message)
    return { ok: false, error: 'editor-unavailable' }
  }
})

ipcMain.handle('mainWindow:upload-web', async (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || typeof request !== 'object') {
    return { ok: false, error: 'unauthorized' }
  }
  try {
    if (!currentFile || typeof currentFile !== 'string' || !path.isAbsolute(currentFile)) {
      throw new Error('No project is open')
    }
    const sceneFilePath = validateMainWindowPath(request.sceneFilePath)
    const zipFilePath = validateMainWindowPath(request.zipFilePath)
    if (path.extname(sceneFilePath).toLowerCase() !== '.storyboarder') throw new Error('Invalid project file')

    const projectRoot = path.resolve(path.dirname(currentFile))
    if (!isPathInside(projectRoot, sceneFilePath)) throw new Error('Project file is outside the open project')
    const exportsRoot = path.resolve(path.dirname(sceneFilePath), 'exports')
    if (!isPathInside(exportsRoot, zipFilePath)) throw new Error('Upload archive is outside the project exports')

    const scene = JSON.parse(readFileUtf8Bounded(sceneFilePath, MAX_PROJECT_INPUT_SIZE))
    if (!scene || !Array.isArray(scene.boards) || scene.boards.length === 0 || scene.boards.length > 100000) {
      throw new Error('Invalid or oversized storyboard data')
    }
    const zipPath = assertReadableFile(zipFilePath, MAX_WEB_ZIP_FILE_SIZE)
    const auth = prefModule.getPrefs('main-window upload').auth
    const token = auth && typeof auth.token === 'string' && auth.token.length <= 4096 ? auth.token : ''
    if (!token) return { ok: false, error: 'not-authenticated', statusCode: 401 }

    const boardModel = require('./models/board')
    const lastBoard = scene.boards[scene.boards.length - 1]
    const duration = Number(lastBoard && lastBoard.time) + Number(boardModel.boardDuration(scene, lastBoard || {}))
    const form = new FormData()
    form.append('title', path.basename(sceneFilePath, path.extname(sceneFilePath)))
    form.append('duration', Number.isFinite(duration) ? duration : 0)
    form.append('boards', scene.boards.length)
    form.append('width', Number.isFinite(Number(scene.aspectRatio)) ? Math.round(Number(scene.aspectRatio) * 720) : 0)
    form.append('height', 720)
    form.append('zip', fileSystem.createReadStream(zipPath))

    const nodeFetch = require('node-fetch')
    const response = await nodeFetch(`https://${UPLOAD_API_HOST}/api/upload`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders()
      },
      body: form
    })
    const bodyText = (await response.text()).slice(0, 256 * 1024)
    let data
    try { data = JSON.parse(bodyText) } catch (err) { data = null }
    if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: response.status === 403 ? 'credentials-expired' : 'upload-failed', statusCode: response.status }
    }
    const safeData = sanitizeJsonValue(data, { maxDepth: 8, maxEntries: 2000, maxStringLength: 65536 }) || {}
    if (typeof safeData.renewedToken === 'string' && safeData.renewedToken.length > 0 && safeData.renewedToken.length <= 4096) {
      prefModule.set('auth', { token: safeData.renewedToken }, true)
      delete safeData.renewedToken
    }
    return { ok: true, data: safeData }
  } catch (err) {
    log.warn('Rejected or failed web upload request', err && err.message ? err.message : 'unknown error')
    return { ok: false, error: 'upload-failed' }
  }
})

ipcMain.handle('mainWindow:process', async (event, request = {}) => {
  if (!isMainWindowSender(event) || !request || request.action !== 'run') return { code: -1, stdout: '', stderr: 'unauthorized' }
  if (!Array.isArray(request.args) || request.args.length > 512 || request.args.some(value => typeof value !== 'string' || value.length > 4096 || value.includes('\0'))) {
    return { code: -1, stdout: '', stderr: 'invalid arguments' }
  }
  try {
    const reportedPath = require('ffmpeg-static')
    const expected = path.resolve(String(reportedPath).replace('app.asar', 'app.asar.unpacked'))
    const command = typeof request.command === 'string' ? path.resolve(request.command.replace('app.asar', 'app.asar.unpacked')) : ''
    if (command !== expected || !fs.existsSync(command) || !fs.statSync(command).isFile()) throw new Error('Only the bundled ffmpeg binary may be executed')
    const cwd = request.cwd ? validateMainWindowPath(request.cwd) : app.getPath('temp')
    const result = await new Promise(resolve => execFile(command, request.args, {
      cwd,
      windowsHide: true,
      maxBuffer: 100 * 1024 * 1024
    }, (error, stdout, stderr) => resolve({
      code: error && Number.isInteger(error.code) ? error.code : error ? 1 : 0,
      stdout: typeof stdout === 'string' ? stdout.slice(0, 100 * 1024 * 1024) : '',
      stderr: typeof stderr === 'string' ? stderr.slice(0, 100 * 1024 * 1024) : ''
    })))
    return result
  } catch (err) {
    log.warn('Rejected main-window process operation', err.message)
    return { code: -1, stdout: '', stderr: 'process unavailable' }
  }
})



// openDialogue (ipc and menu)
ipcMain.on('openDialogue', event => {
  if (isKnownAppWindowSender(event)) openDialogue()
})
menuBus.on('openDialogue', () => openDialogue())

// importImagesDialogue (ipc and menu)
ipcMain.on('importImagesDialogue', (e, arg) => {
  if (!isMainWindowSender(e)) return
  importImagesDialogue(arg)
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('importNotification', Boolean(arg))
})
menuBus.on('importImagesDialogue', (e, arg) => {
  importImagesDialogue(arg)
  mainWindow.webContents.send('importNotification', arg)
})



ipcMain.on('createNew', (e, aspectRatio) => {
  if (!isNewWindowSender(e)) return
  aspectRatio = normalizeAspectRatio(aspectRatio)
  if (aspectRatio === null) return
  newWindow.hide()

  let isProject = currentFile && (path.extname(currentFile) === '.fdx' || path.extname(currentFile) === '.fountain')
  if (isProject) {
    createAndLoadProject(aspectRatio)
  } else {
    createAndLoadScene(aspectRatio)
  }
})

ipcMain.on('openNewWindow', (e, arg)=> {
  if (!isWelcomeWindowSender(e) && !isMainWindowSender(e)) return
  openNewWindow()
})

ipcMain.handle('newWindow:getData', event => {
  if (!isNewWindowSender(event)) throw new Error('Unauthorized new-window request')
  return { translations: translationsForKeys(NEW_WINDOW_TRANSLATION_KEYS) }
})

ipcMain.on('newWindow:hide', event => {
  if (isNewWindowSender(event) && newWindow && !newWindow.isDestroyed()) newWindow.hide()
})

ipcMain.on('preventSleep', event => {
  if (!isMainWindowSender(event)) return
  powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
})

ipcMain.on('resumeSleep', event => {
  if (!isMainWindowSender(event)) return
  if (powerSaveId && powerSaveBlocker.isStarted(powerSaveId)) powerSaveBlocker.stop(powerSaveId)
  powerSaveId = 0
})

/// menu pass through

ipcMain.on('goBeginning', (event, arg)=> {
  if (!isKnownAppWindowSender(event)) return
  sendToMainWindow('goBeginning')
})

ipcMain.on('goPreviousScene', (event, arg)=> {
  if (!isKnownAppWindowSender(event)) return
  sendToMainWindow('goPreviousScene')
})

ipcMain.on('goPrevious', (event, arg)=> {
  if (!isKnownAppWindowSender(event)) return
  sendToMainWindow('goPrevious')
})

ipcMain.on('goNext', (event, arg)=> {
  if (!isKnownAppWindowSender(event)) return
  sendToMainWindow('goNext')
})

ipcMain.on('goNextScene', (event, arg)=> {
  if (!isKnownAppWindowSender(event)) return
  sendToMainWindow('goNextScene')
})

menuBus.on('toggleSpeaking', (event, arg)=> {
  mainWindow.webContents.send('toggleSpeaking')
})

menuBus.on('stopAllSounds', event =>
  mainWindow.webContents.send('stopAllSounds'))

menuBus.on('addAudioFile', event =>
  mainWindow.webContents.send('addAudioFile'))

ipcMain.on('playsfx', (event, arg)=> {
  if (!isKnownAppWindowSender(event) || !['negative', 'rollover', 'down', 'error', 'positive'].includes(arg)) return
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.webContents.send('playsfx', arg)
  }
})

ipcMain.on('test', (event, arg)=> {
  if (!isKnownAppWindowSender(event)) return
  log.info('test', arg)
})

ipcMain.on('textInputMode', (event, arg)=> {
  if (!isMainWindowSender(event) || typeof arg !== 'boolean') return
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('textInputMode', arg)
})

menuBus.on('preferences', (event, arg) => {
  preferencesUI.show()
})

ipcMain.handle('preferences:getData', event => {
  if (!isPreferencesWindowSender(event)) throw new Error('Unauthorized preferences request')
  return preferencesDataForRenderer()
})

ipcMain.handle('preferences:set', (event, request) => {
  if (!isPreferencesWindowSender(event)) return { ok: false, error: 'unauthorized' }
  if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.name !== 'string') {
    return { ok: false, error: 'invalid-request' }
  }
  const { name, value } = request
  if (PREFERENCES_BOOLEAN_KEYS.has(name)) {
    if (typeof value !== 'boolean') return { ok: false, error: 'invalid-value' }
  } else if (name === 'defaultBoardTiming') {
    if (!Number.isInteger(value) || value < 0 || value > 24 * 60 * 60 * 1000) {
      return { ok: false, error: 'invalid-value' }
    }
  } else if (name === 'straightLineDelayInMsecs') {
    if (!Number.isInteger(value) || value < 0 || value > 1500) return { ok: false, error: 'invalid-value' }
  } else {
    return { ok: false, error: 'unsupported-preference' }
  }
  prefModule.set(name, value, true)
  return { ok: true }
})

ipcMain.handle('preferences:select-image-editor', async event => {
  if (!isPreferencesWindowSender(event)) return { ok: false, error: 'unauthorized' }
  const parent = preferencesUI.getWindow && preferencesUI.getWindow()
  const result = await dialog.showOpenDialog(parent, { title: 'Select Image Editor Application' })
  if (result.canceled || !result.filePaths.length) {
    prefModule.set('absolutePathToImageEditor', undefined, true)
    return { ok: true, selected: false }
  }
  const selected = result.filePaths[0]
  try {
    if (typeof selected !== 'string' || selected.length > 4096 || selected.includes('\0') || !path.isAbsolute(selected)) {
      throw new Error('invalid editor path')
    }
    const stat = fs.statSync(selected)
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('editor path is unavailable')
    prefModule.set('absolutePathToImageEditor', selected, true)
    return { ok: true, selected: true }
  } catch (err) {
    return { ok: false, error: 'invalid-editor' }
  }
})

ipcMain.handle('preferences:import-watermark', async event => {
  if (!isPreferencesWindowSender(event)) return { ok: false, error: 'unauthorized' }
  const parent = preferencesUI.getWindow && preferencesUI.getWindow()
  const result = await dialog.showOpenDialog(parent, {
    title: 'Import Watermark Image File',
    properties: ['openFile'],
    filters: [{ name: 'Watermark Image (PNG)', extensions: ['png'] }]
  })
  if (result.canceled || !result.filePaths.length) {
    prefModule.set('userWatermark', undefined, true)
    return { ok: true, selected: false }
  }
  try {
    const selected = assertReadableFile(result.filePaths[0], 20 * 1024 * 1024)
    if (path.extname(selected).toLowerCase() !== '.png') throw new Error('not a PNG file')
    const header = fs.readFileSync(selected).subarray(0, 8)
    if (!header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      throw new Error('invalid PNG signature')
    }
    const destination = resolveForWriteInside(app.getPath('userData'), 'watermark.png')
    fs.copySync(selected, destination, { overwrite: true })
    prefModule.set('userWatermark', path.basename(selected), true)
    return { ok: true, selected: true }
  } catch (err) {
    log.warn('Rejected invalid watermark import', err.message)
    return { ok: false, error: 'invalid-watermark' }
  }
})

ipcMain.handle('preferences:reveal-keymap', event => {
  if (!isPreferencesWindowSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const keymapPath = resolveForWriteInside(app.getPath('userData'), 'keymap.json')
    shell.showItemInFolder(keymapPath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'unavailable' }
  }
})

ipcMain.handle('preferences:sign-out', event => {
  if (!isPreferencesWindowSender(event)) return { ok: false, error: 'unauthorized' }
  prefModule.set('auth', undefined, true)
  return { ok: true }
})

ipcMain.handle('preferences:select-language', (event, fileName) => {
  if (!isPreferencesWindowSender(event) || !isSafeLanguageCode(fileName)) {
    return { ok: false, error: 'invalid-language' }
  }
  const languages = normalizeLanguageList()
  if (!languages.some(item => item.fileName === fileName)) return { ok: false, error: 'unknown-language' }
  languageSettings.setSettingByKey('selectedLanguage', fileName)
  notifyAllsWindows('languageChanged', fileName)
  return { ok: true }
})

menuBus.on('toggleGuide', (event, arg) => {
  mainWindow.webContents.send('toggleGuide', arg)
})

menuBus.on('toggleOnionSkin', event =>
  mainWindow.webContents.send('toggleOnionSkin'))

menuBus.on('toggleNewShot', (event, arg) => {
  mainWindow.webContents.send('toggleNewShot', arg)
})

menuBus.on('showTip', (event, arg) => {
  mainWindow.webContents.send('showTip', arg)
})

menuBus.on('exportAnimatedGif', (event, arg) => {
  mainWindow.webContents.send('exportAnimatedGif', arg)
})

menuBus.on('exportVideo', (event, arg) => {
  mainWindow.webContents.send('exportVideo', arg)
})

menuBus.on('exportFcp', (event, arg) => {
  mainWindow.webContents.send('exportFcp', arg)
})

menuBus.on('exportImages', (event, arg) => {
  mainWindow.webContents.send('exportImages', arg)
})

menuBus.on('exportWeb', (event, arg) => {
  mainWindow.webContents.send('exportWeb', arg)
})
menuBus.on('exportZIP', (event, arg) => {
  mainWindow.webContents.send('exportZIP', arg)
})

menuBus.on('exportCleanup', (event, arg) => {
  mainWindow.webContents.send('exportCleanup', arg)
})

menuBus.on('save', (event, arg) => {
  mainWindow.webContents.send('save', arg)
})

menuBus.on('saveAs', (event, arg) => {
  mainWindow.webContents.send('saveAs', arg)
})

ipcMain.on('prefs:change', (event, arg) => {
  if (!isWindowSender(event, [mainWindow, preferencesUI.getWindow && preferencesUI.getWindow()])) return
  const changedPrefs = normalizePrefsChange(arg)
  if (!changedPrefs || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('prefs:change', changedPrefs)
})

menuBus.on('showKeyCommands', (event, arg) => {
  openKeyCommandWindow()
})

menuBus.on('showAbout', () => {
  openAboutWindow()
})

ipcMain.on('analyticsScreen', (event, screenName) => {
  if (!isKnownAppWindowSender(event)) return
})

ipcMain.on('analyticsEvent', (event, category, action, label, value) => {
  if (!isKnownAppWindowSender(event)) return
})

ipcMain.on('analyticsTiming', (event, category, name, ms) => {
  if (!isKnownAppWindowSender(event)) return
})

ipcMain.on('log', (event, opt) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
  if (!loadingStatusWindow || loadingStatusWindow.isDestroyed()) return
  if (!opt || typeof opt !== 'object' || Array.isArray(opt)) return
  if (!['progress', 'error'].includes(opt.type) || typeof opt.message !== 'string') return
  loadingStatusWindow.webContents.send('log', {
    type: opt.type,
    message: opt.message.slice(0, 4096)
  })
})

ipcMain.on('workspaceReady', event => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
  mcpRendererReady = true
  flushMcpBridgeQueue()
  if (loadingStatusWindow && !loadingStatusWindow.isDestroyed()) loadingStatusWindow.hide()

  if (!mainWindow) return
  
  if (os.platform() == 'win32') {
    setTimeout(()=> {mainWindow.show()}, 1000)
  } else {
    mainWindow.show()
  }

  // only after the workspace is ready will it start getting future focus events
  mainWindow.on('focus', () => {
    mainWindow.webContents.send('focus')

    // if we're on a script-based project ...
    let isProject = currentFile && (path.extname(currentFile) === '.fdx' || path.extname(currentFile) === '.fountain')
    if (isProject) {
      // force an onScriptFileChange call
      onScriptFileChange('change', currentFile)
    }
  })
})

const notifyAllsWindows = (event, ...args) => {
  let allWindows = BrowserWindow.getAllWindows()
  for(let i = 0; i < allWindows.length; i ++) {
    if(!allWindows[i] || allWindows[i].isDestroyed()) continue
    try {
      allWindows[i].webContents.send(event, ...args)
    } catch (err) {
      log.warn('Could not notify renderer window', event)
    }
  }
}

ipcMain.on('keyCommands:getData', event => {
  if (!isWindowSender(event, [keyCommandWindow])) {
    event.returnValue = null
    return
  }
  const currentKeymap = store.getState().entities.keymap
  const keymap = {}
  for (const [key, value] of Object.entries(currentKeymap || {}).slice(0, 1000)) {
    if (typeof key === 'string' && key.length <= 256 && typeof value === 'string' && value.length <= 256) {
      keymap[key] = value
    }
  }
  event.returnValue = { platform: process.platform, keymap }
})

ipcMain.on('languageChanged', (event, lng) => {
  if (!isKnownAppWindowSender(event) || !isSafeLanguageCode(lng)) return
  languageSettings._loadFile()
  notifyAllsWindows("languageChanged", lng)
})

ipcMain.on('languageModified', (event, lng) => {
  if (!isKnownAppWindowSender(event) || !isSafeLanguageCode(lng)) return
  notifyAllsWindows("languageModified", lng)
})

ipcMain.on('languageAdded', (event, lng) => {
  if (!isKnownAppWindowSender(event) || !isSafeLanguageCode(lng)) return
  languageSettings._loadFile()
  notifyAllsWindows("languageAdded", lng)
})

ipcMain.on('languageRemoved', (event, lng) => {
  if (!isKnownAppWindowSender(event) || !isSafeLanguageCode(lng)) return
  languageSettings._loadFile()
  notifyAllsWindows("languageRemoved", lng)
})

ipcMain.on('getCurrentLanguage', (event) => {
  event.returnValue = isKnownAppWindowSender(event) && isSafeLanguageCode(languageSettings.getSettingByKey("selectedLanguage"))
    ? languageSettings.getSettingByKey("selectedLanguage")
    : 'en-US'
})

ipcMain.on('openLanguagePreferences', (event) => {
  if (!isKnownAppWindowSender(event)) return
  let win = LanguagePreferencesWindow.getWindow()
  if (win) {
    LanguagePreferencesWindow.reveal()
  } else {
    LanguagePreferencesWindow.createWindow(() => {LanguagePreferencesWindow.reveal()})
  }
})



// PDF Export
menuBus.on('exportPDF', () => {
  if (!mainWindow) return

  printProject.show({ parent: mainWindow })
})
ipcMain.handle('exportPDF:getData', async (event) => {
  const printWindow = printProject.getWindow && printProject.getWindow()
  if (!printWindow || printWindow.isDestroyed() || event.sender !== printWindow.webContents) {
    throw new Error('Unauthorized PDF export request')
  }
  if (!mainWindow) return

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('exportPDF:getProjectData-response', onResponse)
      reject(new Error('Timed out waiting for project data'))
    }, 30000)
    const onResponse = async (responseEvent, projectData) => {
      if (!mainWindow || responseEvent.sender !== mainWindow.webContents) return
      clearTimeout(timeout)
      ipcMain.removeListener('exportPDF:getProjectData-response', onResponse)
      try {
        const project = await printProjectDataLoader.getProjectData({
          currentFilePath: currentFile,
          projectData
        })
        printProjectIpc.setProject(project)
        const selectedLocale = readLocaleData(languageSettings.getSettingByKey('selectedLanguage')) || {}
        resolve({
          currentFilePath: currentFile,
          projectData,
          project,
          translations: translationsForKeys(allTranslationKeys(selectedLocale))
        })
      } catch (err) {
        reject(err)
      }
    }
    ipcMain.on('exportPDF:getProjectData-response', onResponse)
    mainWindow.webContents.send('exportPDF:getProjectData-request')
  })
})

// Worksheet Export
menuBus.on('printWorksheet', () => {
  if (!mainWindow) return

  printWorksheet.show({ parent: mainWindow })
})
ipcMain.handle('printWorksheet:getData', async (event) => {
  const printWindow = printWorksheet.getWindow && printWorksheet.getWindow()
  if (!printWindow || printWindow.isDestroyed() || event.sender !== printWindow.webContents) {
    throw new Error('Unauthorized worksheet export request')
  }
  if (!mainWindow) return

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('printWorksheet:getProjectData-response', onResponse)
      reject(new Error('Timed out waiting for project data'))
    }, 30000)
    const onResponse = (responseEvent, projectData) => {
      if (!mainWindow || responseEvent.sender !== mainWindow.webContents) return
      clearTimeout(timeout)
      ipcMain.removeListener('printWorksheet:getProjectData-response', onResponse)
      activeWorksheetProjectData = projectData
      const selectedLocale = readLocaleData(languageSettings.getSettingByKey('selectedLanguage')) || {}
      resolve({
        currentFilePath: currentFile,
        projectData,
        translations: translationsForKeys(allTranslationKeys(selectedLocale))
      })
    }
    ipcMain.on('printWorksheet:getProjectData-response', onResponse)
    mainWindow.webContents.send('printWorksheet:getProjectData-request')
  })
})

ipcMain.on('exportPrintableWorksheetPdf', (event, sourcePath) => {
  const printWindow = printWorksheet.getWindow && printWorksheet.getWindow()
  if (!printWindow || event.sender !== printWindow.webContents) return
  if (typeof sourcePath !== 'string' || sourcePath.length === 0 || sourcePath.length > 4096 || sourcePath.includes('\0')) return
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('exportPrintableWorksheetPdf', sourcePath)
})

const isPrintWorksheetSender = event => {
  const window = printWorksheet.getWindow && printWorksheet.getWindow()
  return Boolean(window && !window.isDestroyed() && event && event.sender === window.webContents)
}

const normalizeWorksheetRequest = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid worksheet request')
  const number = (candidate, fallback, min, max) => {
    const parsed = Number(candidate)
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
  }
  return {
    paperSize: value.paperSize === 'LTR' ? 'LTR' : 'A4',
    aspectRatio: number(value.aspectRatio, 1.778, 0.1, 10),
    rows: Math.round(number(value.rows, 5, 1, 8)),
    cols: Math.round(number(value.cols, 3, 1, 8)),
    spacing: number(value.spacing, 15, 0, 100),
    copies: Math.round(number(value.copies, 1, 1, 99))
  }
}

const generateWorksheetPdf = async request => {
  if (!activeWorksheetProjectData || typeof activeWorksheetProjectData !== 'object') throw new Error('No worksheet project is open')
  const normalized = normalizeWorksheetRequest(request)
  const scriptData = Array.isArray(activeWorksheetProjectData.scriptData)
    ? sanitizeJsonValue(activeWorksheetProjectData.scriptData, { maxDepth: 12, maxEntries: 100000, maxArrayLength: 100000, maxStringLength: 1024 * 1024 })
    : null
  const scene = Number.isFinite(Number(activeWorksheetProjectData.currentScene)) ? Number(activeWorksheetProjectData.currentScene) : 0
  const generatedPath = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worksheetPrinter.removeListener('generated', onGenerated)
      reject(new Error('Worksheet generation timed out'))
    }, 30000)
    const onGenerated = filepath => {
      clearTimeout(timeout)
      worksheetPrinter.removeListener('generated', onGenerated)
      resolve(filepath)
    }
    worksheetPrinter.once('generated', onGenerated)
    try {
      worksheetPrinter.generate(normalized.paperSize, normalized.aspectRatio, normalized.rows, normalized.cols, normalized.spacing, scene, '', scriptData)
    } catch (err) {
      clearTimeout(timeout)
      worksheetPrinter.removeListener('generated', onGenerated)
      reject(err)
    }
  })
  return { filepath: generatedPath, normalized }
}

ipcMain.handle('printWorksheet:generate', async (event, request) => {
  if (!isPrintWorksheetSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const generated = await generateWorksheetPdf(request)
    const pdf = fs.readFileSync(assertReadableFile(generated.filepath, 50 * 1024 * 1024)).toString('base64')
    return { ok: true, pdf, pagePath: path.basename(generated.filepath) }
  } catch (err) {
    log.warn('Could not generate worksheet', err.message)
    return { ok: false, error: 'worksheet-generation-failed' }
  }
})

ipcMain.handle('printWorksheet:print', async (event, request) => {
  if (!isPrintWorksheetSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const generated = await generateWorksheetPdf(request)
    const printer = createPrint({ pathToSumatraExecutable: path.join(process.resourcesPath || '', 'app', 'src', 'data', 'app', 'SumatraPDF.exe') })
    printer({ filepath: generated.filepath, paperSize: generated.normalized.paperSize === 'LTR' ? 'letter' : 'a4', paperOrientation: 'landscape', copies: generated.normalized.copies })
    return { ok: true }
  } catch (err) {
    log.warn('Could not print worksheet', err.message)
    return { ok: false, error: 'worksheet-print-failed' }
  }
})

ipcMain.handle('printWorksheet:export', async (event, request) => {
  if (!isPrintWorksheetSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const generated = await generateWorksheetPdf(request)
    const result = await dialog.showSaveDialog(printWorksheet.getWindow(), {
      defaultPath: 'storyboard-worksheet.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { ok: true, canceled: true }
    if (path.extname(result.filePath).toLowerCase() !== '.pdf') throw new Error('PDF output required')
    const destination = resolveForWriteInside(path.dirname(result.filePath), path.basename(result.filePath))
    fs.copyFileSync(assertReadableFile(generated.filepath, 50 * 1024 * 1024), destination)
    return { ok: true }
  } catch (err) {
    log.warn('Could not export worksheet', err.message)
    return { ok: false, error: 'worksheet-export-failed' }
  }
})

ipcMain.handle('printWorksheet:getState', event => {
  if (!isPrintWorksheetSender(event)) return { ok: false, error: 'unauthorized' }
  const prefs = prefModule.getPrefs('print worksheet')
  return { ok: true, state: sanitizeJsonValue(prefs.printingWindowState, { maxDepth: 4, maxEntries: 32 }) || null }
})

ipcMain.handle('printWorksheet:setState', (event, state) => {
  if (!isPrintWorksheetSender(event)) return { ok: false, error: 'unauthorized' }
  const sanitized = sanitizeJsonValue(state, { maxDepth: 4, maxEntries: 32 })
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return { ok: false, error: 'invalid-state' }
  prefModule.set('printingWindowState', sanitized, true)
  return { ok: true }
})

ipcMain.on('printWorksheet:hide', event => {
  if (!isPrintWorksheetSender(event)) return
  const window = printWorksheet.getWindow && printWorksheet.getWindow()
  if (window && !window.isDestroyed()) window.hide()
})

const isPrintProjectSender = event => {
  const window = printProject.getWindow && printProject.getWindow()
  return Boolean(window && !window.isDestroyed() && event && event.sender === window.webContents)
}

const normalizePrintRequest = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid print request')
  const request = sanitizeJsonValue(value, {
    maxDepth: 12,
    maxEntries: 2000,
    maxArrayLength: 100,
    maxStringLength: 64 * 1024
  })
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid print request')
  return request
}

ipcMain.handle('printProject:generatePreview', async (event, request) => {
  if (!isPrintProjectSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const result = await printProjectIpc.generatePreview(normalizePrintRequest(request))
    if (!result || typeof result.pdf !== 'string' || result.pdf.length > 70 * 1024 * 1024) {
      return { ok: false, error: 'preview-too-large' }
    }
    return { ok: true, ...result }
  } catch (err) {
    log.warn('Could not generate PDF preview', err.message)
    return { ok: false, error: 'preview-failed' }
  }
})

ipcMain.handle('printProject:export', async (event, request) => {
  if (!isPrintProjectSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const result = await printProjectIpc.exportPdf(normalizePrintRequest(request))
    return { ok: true, filepath: path.basename(result.filepath) }
  } catch (err) {
    log.warn('Could not export PDF', err.message)
    return { ok: false, error: 'export-failed' }
  }
})

ipcMain.handle('printProject:print', async (event, request) => {
  if (!isPrintProjectSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const normalized = normalizePrintRequest(request)
    const result = await printProjectIpc.printPdf(normalized.context || normalized, normalized)
    return result
  } catch (err) {
    log.warn('Could not print PDF', err.message)
    return { ok: false, error: 'print-failed' }
  }
})

ipcMain.handle('printProject:showItemInFolder', (event, filename) => {
  if (!isPrintProjectSender(event) || typeof filename !== 'string' || filename.length > 255 || !currentFile) {
    return { ok: false, error: 'unauthorized' }
  }
  try {
    const exportsRoot = resolveInside(path.dirname(currentFile), 'exports')
    const filepath = resolveInside(exportsRoot, filename)
    shell.showItemInFolder(filepath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'invalid-file' }
  }
})

ipcMain.handle('printProject:getPrefs', event => {
  if (!isPrintProjectSender(event)) return { ok: false, error: 'unauthorized' }
  const state = prefModule.getPrefs('print project')
  return { ok: true, state: sanitizeJsonValue(state && state.printProjectState, { maxDepth: 8, maxEntries: 200 }) || null }
})

ipcMain.handle('printProject:setPrefs', (event, state) => {
  if (!isPrintProjectSender(event)) return { ok: false, error: 'unauthorized' }
  const sanitized = sanitizeJsonValue(state, { maxDepth: 8, maxEntries: 200 })
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return { ok: false, error: 'invalid-state' }
  prefModule.set('printProjectState', sanitized, true)
  return { ok: true }
})

ipcMain.on('printProject:hide', event => {
  if (!isPrintProjectSender(event)) return
  const window = printProject.getWindow && printProject.getWindow()
  if (window && !window.isDestroyed()) window.hide()
})

ipcMain.on('printProject:setMenu', event => {
  if (!isPrintProjectSender(event)) return
  // Menu ownership remains in the main process. The renderer can request the
  // print menu but cannot pass arbitrary menu definitions or callbacks.
  try {
    const i18n = require('./services/i18next.config')
    const menu = require('./main/menu')
    menu.setPrintProjectMenu(i18n)
  } catch (err) {
    log.warn('Could not set print project menu', err.message)
  }
})

ipcMain.handle('languagePreferences:getData', (event, fileName) => {
  if (!isLanguagePreferencesWindowSender(event)) throw new Error('Unauthorized language preferences request')
  return languagePreferencesDataForRenderer(fileName)
})

ipcMain.handle('languagePreferences:select', (event, fileName) => {
  if (!isLanguagePreferencesWindowSender(event) || !languageInfo(fileName)) return { ok: false, error: 'invalid-language' }
  languageSettings.setSettingByKey('selectedLanguage', fileName)
  notifyAllsWindows('languageChanged', fileName)
  return { ok: true, data: languagePreferencesDataForRenderer(fileName) }
})

ipcMain.handle('languagePreferences:save', (event, request) => {
  if (!isLanguagePreferencesWindowSender(event) || !request || typeof request !== 'object' ||
    !isSafeLanguageCode(request.fileName) || languageIsBuiltIn(request.fileName)) {
    return { ok: false, error: 'language-not-editable' }
  }
  try {
    const info = languageInfo(request.fileName)
    const normalized = normalizeLanguageJson(request.json, info && info.displayName)
    const filepath = languageFilePath(request.fileName)
    fs.writeFileSync(filepath, normalized.serialized, 'utf8')
    const customLanguages = (Array.isArray(languageSettings.getSettingByKey('customLanguages'))
      ? languageSettings.getSettingByKey('customLanguages')
      : []).map(item => item && item.fileName === request.fileName
      ? { fileName: request.fileName, displayName: normalized.displayName }
      : item).filter(item => item && isSafeLanguageCode(item.fileName))
    languageSettings.setSettings({ customLanguages })
    notifyAllsWindows('languageModified', request.fileName)
    return { ok: true, data: languagePreferencesDataForRenderer(request.fileName) }
  } catch (err) {
    log.warn('Could not save language file', err.message)
    return { ok: false, error: 'language-save-failed' }
  }
})

ipcMain.handle('languagePreferences:add', (event, request) => {
  if (!isLanguagePreferencesWindowSender(event) || !request || typeof request !== 'object') {
    return { ok: false, error: 'invalid-request' }
  }
  try {
    const normalized = normalizeLanguageJson(request.json, request.displayName)
    const fileName = writeCustomLanguage(normalized.displayName, normalized.data)
    return { ok: true, data: languagePreferencesDataForRenderer(fileName) }
  } catch (err) {
    log.warn('Could not add language', err.message)
    return { ok: false, error: 'language-add-failed' }
  }
})

ipcMain.handle('languagePreferences:remove', (event, fileName) => {
  if (!isLanguagePreferencesWindowSender(event) || !isSafeLanguageCode(fileName) || languageIsBuiltIn(fileName)) {
    return { ok: false, error: 'language-not-removable' }
  }
  try {
    const filepath = languageFilePath(fileName)
    fs.removeSync(filepath)
    const customLanguages = (Array.isArray(languageSettings.getSettingByKey('customLanguages'))
      ? languageSettings.getSettingByKey('customLanguages')
      : []).filter(item => item && item.fileName !== fileName && isSafeLanguageCode(item.fileName))
    const fallback = normalizeLanguageList().find(item => languageIsBuiltIn(item.fileName))
    if (!fallback) throw new Error('No built-in language available')
    languageSettings.setSettings({ selectedLanguage: fallback.fileName, customLanguages })
    notifyAllsWindows('languageRemoved', fallback.fileName)
    notifyAllsWindows('languageChanged', fallback.fileName)
    return { ok: true, data: languagePreferencesDataForRenderer(fallback.fileName) }
  } catch (err) {
    log.warn('Could not remove language', err.message)
    return { ok: false, error: 'language-remove-failed' }
  }
})

ipcMain.handle('languagePreferences:export', async (event, request) => {
  if (!isLanguagePreferencesWindowSender(event) || !request || !isSafeLanguageCode(request.fileName)) {
    return { ok: false, error: 'invalid-request' }
  }
  try {
    const result = await dialog.showOpenDialog(LanguagePreferencesWindow.getWindow(), {
      properties: ['openDirectory'],
      buttonLabel: 'Export'
    })
    if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true }
    const data = languageDataForRenderer(request.fileName)
    const base = safeFilename(data.Name, 'language')
    const root = result.filePaths[0]
    let filename = `${base}.json`
    let destination = resolveForWriteInside(root, filename)
    let index = 1
    while (pathExists(destination) && index < 100) {
      filename = `${base} new${index === 1 ? '' : ` ${index}`}.json`
      destination = resolveForWriteInside(root, filename)
      index++
    }
    fs.writeFileSync(destination, JSON.stringify(data), 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'language-export-failed' }
  }
})

ipcMain.handle('languagePreferences:import', async event => {
  if (!isLanguagePreferencesWindowSender(event)) return { ok: false, error: 'unauthorized' }
  try {
    const result = await dialog.showOpenDialog(LanguagePreferencesWindow.getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Json', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true }
    const filepath = assertReadableFile(result.filePaths[0], 1024 * 1024)
    const parsed = JSON.parse(readFileUtf8Bounded(filepath, 1024 * 1024))
    const displayName = parsed && typeof parsed.Name === 'string' ? parsed.Name : path.parse(filepath).name
    const fileName = writeCustomLanguage(displayName, parsed)
    return { ok: true, data: languagePreferencesDataForRenderer(fileName) }
  } catch (err) {
    return { ok: false, error: 'language-import-failed' }
  }
})

menuBus.on('toggleAudition', (event) => {
  mainWindow.webContents.send('toggleAudition')
})

// uploader > main-window
ipcMain.on('signInSuccess', (event, response) => {
  const senderUrl = event.sender && event.sender.getURL ? event.sender.getURL() : ''
  const registrationWindow = registration.getWindow && registration.getWindow()
  const isRegistrationSender = registrationWindow && !registrationWindow.isDestroyed() &&
    event.sender === registrationWindow.webContents
  let isUploadSender = false
  try {
    const parsed = new URL(senderUrl)
    const filePath = require('url').fileURLToPath(parsed)
    isUploadSender = isTrustedAppUrl(senderUrl) && path.basename(filePath).toLowerCase() === 'upload.html'
  } catch (err) {
    isUploadSender = false
  }
  const isRegistrationOrUpload = Boolean(isRegistrationSender) || isUploadSender
  if (!isRegistrationOrUpload || !response || typeof response.token !== 'string' || response.token.length > 4096 ||
    !mainWindow || mainWindow.isDestroyed()) {
    log.warn('Rejected invalid sign-in IPC message')
    return
  }
  // Keep the bearer token in the main process.  The main renderer only gets
  // a notification that authentication succeeded, so an injected project
  // string cannot read the credential through its preference compatibility
  // layer.
  prefModule.set('auth', { token: response.token }, true)
  // Only forward the credential that the main renderer consumes.  Keeping
  // server-controlled profile fields out of this IPC hop avoids accidentally
  // reintroducing an HTML sink in the legacy uploader UI.
  mainWindow.webContents.send('signInSuccess', { authenticated: true })
})

ipcMain.on('audio:request-permission', event => {
  if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) {
    mediaPermissionExpiry.set(event.sender, Date.now() + 30 * 1000)
  }
})

const isUploadPage = sender => {
  try {
    const url = new URL(sender.getURL())
    return isTrustedAppUrl(url.toString()) &&
      url.protocol === 'file:' && path.basename(url.pathname).toLowerCase() === 'upload.html'
  } catch (err) {
    return false
  }
}

ipcMain.handle('upload:login', async (event, credentials = {}) => {
  if (!isUploadPage(event.sender)) throw new Error('Unauthorized upload IPC sender')
  if (
    !credentials ||
    typeof credentials.email !== 'string' || credentials.email.length > MAX_UPLOAD_LOGIN_FIELD_LENGTH ||
    typeof credentials.password !== 'string' || credentials.password.length > MAX_UPLOAD_LOGIN_FIELD_LENGTH
  ) {
    throw new Error('Invalid login details')
  }
  const response = await fetch(UPLOAD_API_LOGIN, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: credentials.email, password: credentials.password }).toString()
  })
  return {
    status: response.status,
    body: (await response.text()).slice(0, 256 * 1024)
  }
})

ipcMain.on('upload:hide', event => {
  if (!isUploadPage(event.sender)) return
  const uploadWindow = BrowserWindow.fromWebContents(event.sender)
  uploadWindow && uploadWindow.hide()
})

ipcMain.handle('upload:open-external', (event, value) => {
  if (!isUploadPage(event.sender)) throw new Error('Unauthorized upload IPC sender')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== UPLOAD_API_HOST) {
    throw new Error('External link is not allow-listed')
  }
  return require('electron').shell.openExternal(url.toString())
})

menuBus.on('zoomReset',
  event => mainWindow.webContents.send('zoomReset'))
menuBus.on('scale-ui-by',
  (event, value) => mainWindow.webContents.send('scale-ui-by', value))
menuBus.on('scale-ui-reset',
  (event, value) => mainWindow.webContents.send('scale-ui-reset', value))



// ipc and menu
ipcMain.on('registration:open', event => {
  if (!isKnownAppWindowSender(event)) return
  registration.show()
})
menuBus.on('registration:open', event => registration.show())


