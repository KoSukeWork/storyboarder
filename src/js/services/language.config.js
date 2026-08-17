const path = require('path')
const { app } = require('electron')

const SettingsService = require('../utils/SettingsService')

const userDataPath = app.getPath('userData')
const settings = new SettingsService(
  path.join(userDataPath, 'locales', 'language-settings.json')
)

module.exports = { 
    settings
}
