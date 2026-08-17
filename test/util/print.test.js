const assert = require('assert')
const createPrint = require('../../src/js/print')

describe('print argument validation', () => {
  const print = createPrint({ pathToSumatraExecutable: 'C:\\Program Files\\SumatraPDF.exe' })

  it('rejects shell-like copy counts before invoking a printer', () => {
    assert.throws(() => print({
      filepath: 'C:\\project\\worksheet.pdf',
      paperSize: 'a4',
      paperOrientation: 'portrait',
      copies: '1; whoami'
    }), /copies/i)
  })

  it('requires an absolute source PDF path', () => {
    assert.throws(() => print({
      filepath: 'worksheet.pdf',
      paperSize: 'a4',
      paperOrientation: 'portrait',
      copies: 1
    }), /absolute PDF path/i)
  })
})
