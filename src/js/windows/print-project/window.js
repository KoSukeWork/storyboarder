const { interpret } = require('xstate')
const React = require('react')
const ReactDOM = require('react-dom')

const { getProjectData } = require('./data')
const { machine: printProjectMachine } = require('./machine')
const { generateToCanvas, exportToFile, displayWarning, requestPrint } = require('./services')
const {
  reportAnalyticsEvent,
  showItemInFolder,
  persist,
  hidePreviewDisplay,
  showPreviewDisplay
} = require('./actions')
const { PrintApp, setTranslations } = require('./components')
const { fromPrefsMemento } = require('./context-helpers-renderer')
const getPresets = require('./presets')

const api = () => window.storyboarderPrintProject || {}
const merge = (left, right) => ({ ...left, ...(right || {}) })

const start = async () => {
  const payload = await api().getData()
  setTranslations(payload && payload.translations)
  const project = await getProjectData(payload)
  const canvas = document.createElement('canvas')
  const presets = getPresets(key => String(key))
  const prefResponse = api().getPrefs ? await api().getPrefs() : null
  const userContext = prefResponse && prefResponse.ok ? fromPrefsMemento(prefResponse.state) : {}
  const systemContext = {
    ...printProjectMachine.context,
    ...Object.entries(presets)[0][1].data
  }

  const service = interpret(
    printProjectMachine
      .withConfig({
        actions: { reportAnalyticsEvent, showItemInFolder, persist, hidePreviewDisplay, showPreviewDisplay },
        services: { generateToCanvas, exportToFile, displayWarning, requestPrint }
      })
      .withContext({
        ...merge(systemContext, userContext),
        project,
        canvas,
        presets
      })
  )
    .onDone(() => api().hide && api().hide())
    .start()

  ReactDOM.render(
    React.createElement(PrintApp, { service, canvas }),
    document.querySelector('.container')
  )

  api().setMenu && api().setMenu('print')
  window.addEventListener('focus', () => setTimeout(() => api().setMenu && api().setMenu('print'), 10))
  document.addEventListener('keyup', event => {
    if (event.target !== document.body) return
    if (event.key === 'ArrowLeft') service.send('DECREMENT_PAGE_TO_PREVIEW')
    if (event.key === 'ArrowRight') service.send('INCREMENT_PAGE_TO_PREVIEW')
    if (event.key === 'Escape') service.send('CLOSE')
  })
}

start().catch(error => {
  const message = document.createElement('div')
  message.textContent = 'Unable to open the print preview.'
  document.querySelector('.container').appendChild(message)
  console.error(error)
})
