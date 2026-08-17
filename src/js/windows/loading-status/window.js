const loadingStatus = window.storyboarderLoadingStatus

const titleEl = document.querySelector('.title')
const messagesEl = document.querySelector('.messages')

const truncateMiddle = value => {
  const text = typeof value === 'string' ? value : ''
  if (text.length <= 64) return text
  const edge = 30
  return `${text.slice(0, edge)}…${text.slice(-edge)}`
}

const params = new URL(document.location.href).searchParams
const title = `Loading ${truncateMiddle(params.get('name'))}`
if (titleEl) titleEl.textContent = title
document.title = title

if (loadingStatus) {
  loadingStatus.onLog(value => {
    if (!messagesEl) return
    if (value.type === 'progress') messagesEl.textContent = `${value.message} …`
    if (value.type === 'error') messagesEl.textContent = `⚠ ${value.message}`
  })
}
