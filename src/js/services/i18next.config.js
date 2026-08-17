let i18n = require('i18next')
let i18nextBackend = require('i18next-fs-backend')
const { app } = require('electron')
const path = require('path')
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

const loadPath = path.join(app.getAppPath(), 'src', 'js', 'locales')
const userDataPath = app.getPath('userData')

const getLoadPath = (lng, namespace) => {
    lng = safeLanguageName(lng)
    let builtInPath = path.join(loadPath, `${lng}.json`)
    const builtInLanguages = Array.isArray(config.getSettingByKey("builtInLanguages"))
        ? config.getSettingByKey("builtInLanguages")
        : []
    if(builtInLanguages.some((item) => item && item.fileName === lng)) {
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

if(!i18n.isInitialized) {
    i18n.init(i18nextOptions)
}

module.exports = i18n
