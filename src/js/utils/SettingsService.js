
const fs = require('fs-extra')

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_SETTINGS_FILE_SIZE = 1024 * 1024

// Language settings are user-editable JSON.  Keep the object graph data-only
// and bounded so a crafted settings file cannot mutate prototypes or exhaust
// the editor while being loaded.
const sanitizeValue = (value, depth = 0) => {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (depth > 8) return undefined
    if (Array.isArray(value)) {
        return value.slice(0, 10000)
            .map(item => sanitizeValue(item, depth + 1))
            .filter(item => item !== undefined)
    }
    if (typeof value !== 'object') return undefined
    const result = Object.create(null)
    for (const [key, item] of Object.entries(value).slice(0, 10000)) {
        if (unsafeKeys.has(key)) continue
        const sanitized = sanitizeValue(item, depth + 1)
        if (sanitized !== undefined) result[key] = sanitized
    }
    return result
}

class SettingsService {

    //NOTE() : Filepath should be absolute path to file
    constructor(filepath) {
        this.settingsFilePath = filepath
        this.objects = Object.create(null)
        this._loadFile()
    }
    
    _loadFile() {
        fs.ensureFileSync(this.settingsFilePath)
        let json
        try {
            const stat = fs.statSync(this.settingsFilePath)
            if (!stat.isFile() || stat.size > MAX_SETTINGS_FILE_SIZE) {
                throw new Error('Settings file is too large or invalid')
            }
            json = fs.readFileSync(this.settingsFilePath, 'utf8')
        } catch (error) {
            console.warn('[settings] ignoring unavailable or oversized settings file:', error.message)
            this.objects = Object.create(null)
            return
        }
        if(!json.length) return
        try {
            const parsed = JSON.parse(json)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this.objects = Object.create(null)
                for (const [key, value] of Object.entries(parsed)) {
                    if (unsafeKeys.has(key)) continue
                    const sanitized = sanitizeValue(value)
                    if (sanitized !== undefined) this.objects[key] = sanitized
                }
            } else {
                console.warn('[settings] ignoring non-object settings file')
                this.objects = Object.create(null)
            }
        } catch (error) {
            console.warn('[settings] ignoring malformed settings file:', error.message)
            this.objects = Object.create(null)
        }
    }

    _saveFile() {
        let settings = JSON.stringify(this.objects, null, 2)
        fs.writeFileSync(this.settingsFilePath, settings)
    }

    setSettings(values) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) return
        let keys = Object.keys(values)
        for(let i = 0; i < keys.length; i++){
            let key = keys[i]
            if (unsafeKeys.has(key)) continue
            const sanitized = sanitizeValue(values[key])
            if (sanitized !== undefined) this.objects[key] = sanitized
        }
        this._saveFile()
    }

    setSettingByKey(key, value) {
        if (typeof key !== 'string' || key.length === 0 || key.length > 256 ||
            unsafeKeys.has(key)) return
        const sanitized = sanitizeValue(value)
        if (sanitized === undefined) return
        this.objects[key] = sanitized
        this._saveFile()
    }

    getSettings() {
        return this.objects
    }
    
    getSettingByKey(name) {
        return this.objects[name]
    }
}

module.exports = SettingsService
