const assert = require('assert')
const { sanitizeMarkup } = require('../../src/js/utils/security')

describe('security markup sanitizer', () => {
  it('keeps only the approved formatting tags', () => {
    const result = sanitizeMarkup('<strong onclick="alert(1)">bold</strong><br><em style="color:red">italic</em>')
    assert.strictEqual(result, '<strong>bold</strong><br><em>italic</em>')
  })

  it('drops executable and remote-content elements', () => {
    const result = sanitizeMarkup('<img src=x onerror="process.exit()"><script>require("fs")</script><svg onload="alert(1)"></svg>safe')
    assert.strictEqual(result, 'safe')
  })

  it('renders unknown elements as inert text', () => {
    const result = sanitizeMarkup('<a href="javascript:alert(1)">click me</a>')
    assert.strictEqual(result, 'click me')
  })
})
