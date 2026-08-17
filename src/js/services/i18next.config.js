let i18n = require('i18next')
let i18nextBackend = require('i18next-fs-backend')
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const { initReactI18next } = require("react-i18next")
const {settings:config} = require('./language.config')

const LANGUAGE_FILE_NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,128}$/
const safeLanguageName = value => {
    if (typeof value !== 'string' || value === '.' || value === '..' ||
        path.isAbsolute(value) || path.win32.isAbsolute(value) || !LANGUAGE_FILE_NAME.test(value)) {
        return 'en-US'
    }
    return value
}

// Resolve bundled locales relative to this module. Electron test runners use
// their own app path (and packaged builds may use an asar app path), so
// app.getAppPath() is not a reliable source-root location here.
const loadPath = path.join(__dirname, '..', 'locales')
const userDataPath = app.getPath('userData')

const getLoadPath = (lng, namespace) => {
    lng = safeLanguageName(lng)
    let builtInPath = path.join(loadPath, `${lng}.json`)
    const builtInLanguages = Array.isArray(config.getSettingByKey("builtInLanguages"))
        ? config.getSettingByKey("builtInLanguages")
        : []
    // This module is loaded by the menu before the ready handler has scanned
    // and persisted builtInLanguages. Prefer an existing packaged locale even
    // while that settings list is still empty.
    if(builtInLanguages.some((item) => item && item.fileName === lng) || fs.existsSync(builtInPath)) {
        return builtInPath
    } else {
        return path.join(userDataPath, "locales", `${lng}.json`)
    }
}

const i18nextOptions = {
 
    interpolation: {
        escapeValue: false
    },

    lng: safeLanguageName(config.getSettingByKey('selectedLanguage')),
    react: {
        useSuspense: true,
        wait: false
    },
    fallbackLng: safeLanguageName(config.getSettingByKey('defaultLanguage')),
    backend: {
        loadPath: getLoadPath,

        jsonIdent: 2
    },
}

if(i18n.default) {
    i18n = i18n.default

}
if(i18nextBackend.default) {
    i18nextBackend = i18nextBackend.default
}
i18n.use(i18nextBackend).use(initReactI18next)

const hasResources = i18n.services && i18n.services.resourceStore &&
    i18n.services.resourceStore.data &&
    Object.keys(i18n.services.resourceStore.data).length > 0
const ready = !i18n.isInitialized || !hasResources
    ? i18n.init(i18nextOptions)
    : Promise.resolve(i18n)

i18n.ready = Promise.resolve(ready)

module.exports = i18n
