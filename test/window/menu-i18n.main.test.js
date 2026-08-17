const assert = require('assert')

describe('main menu translations', function () {
  this.timeout(10000)

  it('loads built-in locale resources before rendering menu labels', async () => {
    const i18n = require('../../src/js/services/i18next.config')
    await i18n.ready

    assert.notStrictEqual(i18n.t('menu.file.title'), 'menu.file.title', JSON.stringify({ language: i18n.language, initialized: i18n.isInitialized, resources: i18n.services && i18n.services.resourceStore && i18n.services.resourceStore.data }))
    assert.notStrictEqual(i18n.t('menu.boards.title'), 'menu.boards.title')
  })
})
