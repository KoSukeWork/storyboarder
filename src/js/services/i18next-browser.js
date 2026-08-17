const en = require('../locales/en-US.json')
const zh = require('../locales/zh-CN.json')
const ru = require('../locales/ru-RU.json')

const resources = { 'en-US': en, 'zh-CN': zh, 'ru-RU': ru }
let language = 'en-US'
const listeners = Object.create(null)
const emit = (name, ...args) => (listeners[name] || []).slice().forEach(listener => listener(...args))
const get = (object, key) => key.split('.').reduce((value, part) => value && value[part], object)
const i18n = {
  isInitialized: true,
  on (name, listener) { (listeners[name] || (listeners[name] = [])).push(listener); return i18n },
  off (name, listener) { if (!listener) delete listeners[name]; else listeners[name] = (listeners[name] || []).filter(item => item !== listener); return i18n },
  t (key) { const value = get(resources[language], key) || get(resources['en-US'], key); return value == null ? key : String(value) },
  changeLanguage (next, callback) { if (resources[next]) language = next; emit('languageChanged', language); if (callback) callback(); return Promise.resolve(i18n) },
  loadLanguages: () => Promise.resolve(),
  reloadResources: () => Promise.resolve(),
  get language () { return language }
}
setTimeout(() => emit('loaded', { [language]: true }), 0)
module.exports = i18n
