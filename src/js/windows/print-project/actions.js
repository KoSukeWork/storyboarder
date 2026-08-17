const { toPrefsMemento } = require('./context-helpers-renderer')

const api = () => window.storyboarderPrintProject || {}

const reportAnalyticsEvent = (context, event) => {
  if (event && event.type === 'done.invoke.exportToFile') {
    api().analytics && api().analytics('Board', 'exportPDF')
  }
  if (event && event.type === 'done.invoke.requestPrint') {
    api().analytics && api().analytics('Board', 'print', null, 1)
  }
}

const showItemInFolder = context => {
  if (api().showItemInFolder && typeof context.filepath === 'string') {
    api().showItemInFolder(context.filepath).catch(() => {})
  }
}

const persist = context => {
  if (api().setPrefs) api().setPrefs(toPrefsMemento(context)).catch(() => {})
}

const hidePreviewDisplay = context => {
  if (context.canvas && context.canvas.parentNode) context.canvas.parentNode.style.visibility = 'hidden'
}

const showPreviewDisplay = context => {
  if (context.canvas && context.canvas.parentNode) context.canvas.parentNode.style.visibility = 'visible'
}

module.exports = { reportAnalyticsEvent, showItemInFolder, persist, hidePreviewDisplay, showPreviewDisplay }
