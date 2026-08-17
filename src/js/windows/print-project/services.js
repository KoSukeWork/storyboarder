const pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs')

const api = () => window.storyboarderPrintProject || {}
const px = value => `${value}px`

const fit = ([wi, hi], [ws, hs]) =>
  ws / hs > wi / hi ? [wi * hs / hi, hs] : [ws, hi * ws / wi]

const decodeBase64 = value => {
  if (typeof value !== 'string' || value.length > 70 * 1024 * 1024) throw new Error('Invalid PDF preview')
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const renderPdf = async (context, bytes) => {
  const oldCanvas = context.canvas
  const parentNode = oldCanvas && oldCanvas.parentNode
  const outputEl = parentNode && parentNode.parentNode
  if (!parentNode || !outputEl) throw new Error('Preview canvas is unavailable')

  const pdfjsLib = await pdfjsLibPromise
  const pdf = await pdfjsLib.getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableWorker: true
  }).promise
  const page = await pdf.getPage(1)
  const full = page.getViewport({ scale: 1 })
  const available = outputEl.getBoundingClientRect()
  const styles = getComputedStyle(outputEl)
  const widthPadding = parseInt(styles.paddingLeft || 0) + parseInt(styles.paddingRight || 0)
  const heightPadding = parseInt(styles.paddingTop || 0) + parseInt(styles.paddingBottom || 0)
  const [width, height] = fit([full.width, full.height], [available.width - widthPadding, available.height - heightPadding])
  const scale = Math.min(width / full.width, height / full.height)
  const viewport = page.getViewport({ scale: scale * window.devicePixelRatio })
  const newCanvas = document.createElement('canvas')
  newCanvas.width = viewport.width
  newCanvas.height = viewport.height
  newCanvas.style.width = px(viewport.width / window.devicePixelRatio)
  newCanvas.style.height = px(viewport.height / window.devicePixelRatio)
  await page.render({ canvasContext: newCanvas.getContext('2d'), viewport }).promise
  return newCanvas
}

const generateToCanvas = async context => {
  const result = await api().generatePreview({
    ...context,
    pages: [context.pageToPreview, context.pageToPreview]
  })
  if (!result || !result.ok) throw new Error('Could not generate preview')
  return renderPdf(context, decodeBase64(result.pdf))
}

const exportToFile = async context => {
  const result = await api().exportPdf(context)
  if (!result || !result.ok) throw new Error('Could not export PDF')
  // Keep only a validated basename in renderer state. The main process owns
  // the absolute path and performs the containment check before revealing it.
  context.filepath = result.filepath
  return result
}

const displayWarning = async (context, event) => {
  const message = event && event.data != null ? String(event.data).slice(0, 4096) : 'Print operation failed'
  alert(message)
}

const requestPrint = async context => {
  const result = await api().printPdf({
    context,
    paperSize: context.paperSizeKey === 'letter' ? 'letter' : 'a4',
    orientation: context.orientation === 'landscape' ? 'landscape' : 'portrait',
    copies: 1
  })
  if (!result || !result.ok) throw new Error('Could not print PDF')
  return result
}

module.exports = { generateToCanvas, exportToFile, displayWarning, requestPrint }
