const api = () => window.storyboarderWelcome || {}

const formatRelativeTime = timestamp => {
  const delta = Date.now() - Number(timestamp)
  const minutes = Math.max(0, Math.round(delta / 60000))
  if (minutes < 1) return 'JUST NOW'
  if (minutes < 60) return `${minutes} MINUTES AGO`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} HOURS AGO`
  const days = Math.round(hours / 24)
  return `${days} DAYS AGO`
}

const onFileDrop = event => {
  event.preventDefault()
  const files = event.dataTransfer && event.dataTransfer.files
  if (!files || !files.length) return
  for (const file of files) {
    const name = typeof file.name === 'string' ? file.name.toLowerCase() : ''
    if (name.endsWith('.storyboarder') || name.endsWith('.fountain')) {
      api().openFile(file.path)
      break
    }
  }
}

const updateRecentDocuments = async () => {
  const response = await api().getData()
  const translations = response && response.translations ? response.translations : {}
  const labels = {
    '.recent': 'welcome-window.recentStoryboards',
    '#getting-started': 'menu.help.getting-started',
    '#new-storyboard': 'welcome-window.new-storyboard',
    '#open-storyboard': 'menu.file.open',
    '#welcome-line-1': 'welcome-window.welcome-line-1',
    '#welcome-line-2': 'welcome-window.welcome-line-2',
    '#welcome-line-3': 'welcome-window.welcome-line-3'
  }
  for (const [selector, key] of Object.entries(labels)) {
    const element = document.querySelector(selector)
    if (element && typeof translations[key] === 'string') element.textContent = translations[key]
  }
  const recent = response && Array.isArray(response.recentDocuments) ? response.recentDocuments : []
  const recentRoot = document.querySelector('#recent')
  recentRoot.replaceChildren()
  for (const item of recent) {
    const itemEl = document.createElement('div')
    itemEl.className = 'recent-item'
    itemEl.dataset.filename = item.filename
    const icon = document.createElement('img')
    icon.src = './img/fileicon.png'
    icon.draggable = false
    const text = document.createElement('div')
    text.className = 'text'
    const title = document.createElement('h2')
    title.textContent = item.title
    text.append(title, document.createTextNode(formatRelativeTime(item.time)))
    itemEl.append(icon, text)
    itemEl.onclick = () => api().openFile(item.filename)
    itemEl.onmouseenter = () => api().playSfx && api().playSfx('rollover')
    itemEl.onpointerdown = () => api().playSfx && api().playSfx('down')
    recentRoot.appendChild(itemEl)
  }
  recentRoot.scrollTop = 0
}

const initialize = async () => {
  const initialData = await api().getData()
  document.querySelector('[data-js="version-number"]').textContent = ` v${initialData && initialData.version ? initialData.version : ''}`
document.querySelector('#close-button').onclick = () => api().close()
document.querySelector('#open-storyboard').onclick = () => api().openDialog()
document.querySelector('#new-storyboard').onclick = () => api().openNewWindow()
document.querySelector('#getting-started').onclick = event => {
  event.preventDefault()
  api().openExternal('https://wonderunit.com/storyboarder/faq/#How-do-I-get-started')
}
for (const selector of ['#getting-started', '#open-storyboard', '#new-storyboard']) {
  const element = document.querySelector(selector)
  element.onmouseenter = () => api().playSfx && api().playSfx('rollover')
  element.onpointerdown = () => api().playSfx && api().playSfx('down')
}
api().onRecentDocumentsChanged && api().onRecentDocumentsChanged(() => updateRecentDocuments().catch(() => {}))
api().onLanguageChanged && api().onLanguageChanged(() => updateRecentDocuments().catch(() => {}))
window.ondragover = event => { event.preventDefault(); return false }
window.ondragleave = event => { event.preventDefault(); return false }
window.ondragend = event => { event.preventDefault(); return false }
window.ondrop = onFileDrop
  updateRecentDocuments().catch(() => {})
}

initialize().catch(() => {})
