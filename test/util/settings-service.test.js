const assert = require('assert')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const SettingsService = require('../../src/js/utils/SettingsService')

describe('SettingsService security', () => {
  it('strips prototype-pollution keys from nested settings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboarder-settings-'))
    const filename = path.join(root, 'settings.json')
    fs.writeFileSync(filename, '{"safe":{"enabled":true,"__proto__":{"polluted":true}},"constructor":{"polluted":true}}')

    try {
      const service = new SettingsService(filename)
      const settings = service.getSettings()
      assert.strictEqual(settings.safe.enabled, true)
      assert.strictEqual(Object.prototype.polluted, undefined)
      assert.strictEqual(Object.prototype.hasOwnProperty.call(settings, 'constructor'), false)

      service.setSettings({ nested: { prototype: { polluted: true }, value: 'ok' } })
      assert.strictEqual(service.getSettingByKey('nested').value, 'ok')
      assert.strictEqual(Object.prototype.polluted, undefined)
    } finally {
      fs.removeSync(root)
    }
  })
})
