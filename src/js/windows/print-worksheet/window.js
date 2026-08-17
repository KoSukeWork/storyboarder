const pdfPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
const api = () => window.storyboarderPrintWorksheet || {}

let projectData
let pageDocument
let pageNumber = 1
let rendering = false
let pendingPage = null
let currentOptions = {
  paperSize: 'A4',
  rows: 5,
  cols: 3,
  spacing: 15,
  copies: 1
}

const $ = selector => document.querySelector(selector)
const applyTranslations = translations => {
  if (!translations || typeof translations !== 'object') return
  const labels = {
    '#config-title': 'print-worksheet.worksheet-title',
    '#config-intro': 'print-worksheet.worksheet-intro',
    '#letter': 'print-worksheet.letter',
    '#format': 'print-worksheet.format',
    '#columns-label': 'print-worksheet.columns-label',
    '#rows-label': 'print-worksheet.rows-label',
    '#spacing-label': 'print-worksheet.spacing-label',
    '#copies-label': 'print-worksheet.copies-label',
    '#print-button': 'print-worksheet.print-button',
    '#pdf-button': 'print-worksheet.pdf-button',
    '#prev_button': 'print-worksheet.prev_button',
    '#next_button': 'print-worksheet.next_button'
  }
  for (const [selector, key] of Object.entries(labels)) {
    const element = $(selector)
    if (element && typeof translations[key] === 'string') element.textContent = translations[key]
  }
}
const displaySpinner = visible => {
  $('#preview-loading').style.display = visible ? 'flex' : 'none'
  for (const selector of ['#paper-size', '#row-number', '#column-number', '#spacing']) $(selector).disabled = visible
}

const decodeBase64 = value => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const renderPage = async number => {
  if (!pageDocument) return
  rendering = true
  const page = await pageDocument.getPage(number)
  const canvas = document.createElement('canvas')
  const viewport = page.getViewport({ scale: 1.5 })
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  $('#preview').src = canvas.toDataURL()
  $('#page_num').textContent = String(number)
  $('#page_count').textContent = String(pageDocument.numPages)
  $('#page-navigation').style.display = pageDocument.numPages > 1 ? 'flex' : 'none'
  rendering = false
  if (pendingPage !== null) {
    const next = pendingPage
    pendingPage = null
    renderPage(next).catch(() => {})
  }
}

const queuePage = number => {
  if (!pageDocument) return
  const next = Math.max(1, Math.min(pageDocument.numPages, number))
  if (rendering) pendingPage = next
  else renderPage(next).catch(() => {})
}

const generate = async () => {
  displaySpinner(true)
  try {
    const result = await api().generate({
      ...currentOptions,
      aspectRatio: projectData && projectData.currentBoardData && projectData.currentBoardData.aspectRatio,
      currentScene: projectData && projectData.currentScene
    })
    if (!result || !result.ok) throw new Error('Worksheet generation failed')
    const pdf = await pdfPromise
    pageDocument = await pdf.getDocument({ data: decodeBase64(result.pdf), isEvalSupported: false, disableWorker: true }).promise
    pageNumber = 1
    await renderPage(pageNumber)
  } catch (error) {
    console.error(error)
    alert('Unable to generate worksheet preview.')
  } finally {
    displaySpinner(false)
  }
}

const saveState = () => api().setState && api().setState({
  paperSize: currentOptions.paperSize,
  rows: currentOptions.rows,
  cols: currentOptions.cols,
  spacing: currentOptions.spacing
}).catch(() => {})

const updateOption = (key, selector, parser = value => value) => {
  $(selector).addEventListener('change', event => {
    currentOptions[key] = parser(event.target.value)
    saveState()
    generate()
  })
}

const load = async () => {
  const response = await api().getData()
  projectData = response && response.projectData
  applyTranslations(response && response.translations)
  const saved = api().getState ? await api().getState() : null
  if (saved && saved.ok && saved.state) currentOptions = { ...currentOptions, ...saved.state }
  $('#paper-size').value = currentOptions.paperSize
  $('#row-number').value = String(currentOptions.rows)
  $('#column-number').value = String(currentOptions.cols)
  $('#spacing').value = String(currentOptions.spacing)

  updateOption('paperSize', '#paper-size')
  updateOption('rows', '#row-number', value => Math.max(1, Math.min(8, Number(value))))
  updateOption('cols', '#column-number', value => Math.max(1, Math.min(8, Number(value))))
  updateOption('spacing', '#spacing', value => Math.max(0, Math.min(100, Number(value))))

  $('#prev_button').onclick = () => queuePage(pageNumber - 1)
  $('#next_button').onclick = () => queuePage(pageNumber + 1)
  $('#close-button').onclick = () => api().hide && api().hide()
  $('#print-button').onclick = async () => {
    const result = await api().print({ ...currentOptions, aspectRatio: projectData.currentBoardData.aspectRatio, currentScene: projectData.currentScene })
    if (!result || !result.ok) alert('Unable to print worksheet.')
    else api().playSfx && api().playSfx('positive')
  }
  $('#pdf-button').onclick = async () => {
    const result = await api().exportPdf({ ...currentOptions, aspectRatio: projectData.currentBoardData.aspectRatio, currentScene: projectData.currentScene })
    if (!result || !result.ok) alert('Unable to export worksheet.')
  }
  window.addEventListener('keyup', event => {
    if (event.key === 'Escape') api().hide && api().hide()
    if (event.key === 'ArrowLeft') queuePage(pageNumber - 1)
    if (event.key === 'ArrowRight') queuePage(pageNumber + 1)
  })
  await generate()
}

load().catch(error => {
  console.error(error)
  alert('Unable to open worksheet printing.')
})
