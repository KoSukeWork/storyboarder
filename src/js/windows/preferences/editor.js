const api = window.storyboarderPreferences

let viewData = {
  prefs: {},
  translations: {},
  languages: [],
  selectedLanguage: 'en-US',
  licensed: false,
  accountEmail: null,
  watermarkExists: false
}
let prefs = {}
let originalPrefs = {}
let inputs
let imgEditorEl
let imgEditorInput
let revealKeyMapFileEl
let signOutEl
let mcpStatusEl
let mcpTokenEl
let mcpCopyConfigEl
let selectedOption
let hasChanged = false

const clone = value => JSON.parse(JSON.stringify(value || {}))
const sToMsecs = value => Math.round(Number(value) * 1000)
const msecsToS = value => Number(value || 0) / 1000
const truncateMiddle = (value, maxLength = 35) => {
  value = String(value || '')
  if (value.length <= maxLength) return value
  const half = Math.floor((maxLength - 1) / 2)
  return `${value.slice(0, half)}…${value.slice(value.length - half)}`
}
const basename = value => String(value || '').split(/[\\/]/).pop() || ''

const sanitizeMarkup = value => {
  const template = document.createElement('template')
  template.innerHTML = String(value == null ? '' : value)
  const allowed = new Set(['strong', 'em', 'b', 'i', 'u', 'br', 'kbd'])
  const visit = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '')
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment()
    const tagName = node.tagName.toLowerCase()
    if (!allowed.has(tagName)) return document.createTextNode(node.textContent || '')
    const clean = document.createElement(tagName)
    for (const child of Array.from(node.childNodes)) clean.appendChild(visit(child))
    return clean
  }
  const output = document.createElement('div')
  for (const child of Array.from(template.content.childNodes)) output.appendChild(visit(child))
  return output.innerHTML
}

const withLastChild = (selector, fn) => {
  const parent = document.querySelector(selector)
  if (parent && parent.lastChild) fn(parent.lastChild)
}
const translation = key => typeof viewData.translations[key] === 'string' ? viewData.translations[key] : ''
const translateText = (selector, key) => withLastChild(selector, el => {
  const value = translation(key)
  if (value) el.textContent = value
})
const translateHtml = (selector, key) => withLastChild(selector, el => {
  const value = translation(key)
  if (value) el.innerHTML = sanitizeMarkup(value)
})

const updateHTML = () => {
  translateText('#preferences-title', 'preferences.title')
  translateText('#restart-hint', 'preferences.restart-hint')
  translateText('#show-tooltips', 'preferences.show-tooltips')
  translateText('#save-automatically', 'preferences.save-automatically')
  translateText('#saving-hint', 'preferences.saving-hint')
  translateText('#force-psd-reload', 'preferences.force-psd-reload')
  translateText('#psd-reload-hint', 'preferences.psd-reload-hint')
  translateText('#default-timing', 'preferences.default-timing')
  translateText('#external-psd-editor', 'preferences.external-psd-editor')
  translateText('#psd-editor-hint', 'preferences.psd-editor-hint')
  translateText('#reveal-keymap-file', 'preferences.reveal-keymap-file')
  translateText('#reveal-keymap-file-hint', 'preferences.reveal-keymap-file-hint')
  translateText('#show-diagnostics', 'preferences.show-diagnostics')
  translateText('#show-diagnostics-hint', 'preferences.show-diagnostics-hint')
  translateText('#line-delay', 'preferences.line-delay')
  translateHtml('#line-delay-hint', 'preferences.line-delay-hint')
  translateText('#notifications', 'preferences.notifications')
  translateText('#show-notifications', 'preferences.show-notifications')
  translateText('#aspirational-message', 'preferences.aspirational-message')
  translateText('#notifications-line-mileage', 'preferences.notifications-line-mileage')
  translateText('#sounds', 'preferences.sounds')
  translateHtml('#sounds-hint', 'preferences.sounds-hint')
  translateText('#drawing-sound-effect', 'preferences.drawing-sound-effect')
  translateText('#drawing-melodies', 'preferences.drawing-melodies')
  translateText('#ui-sound-effect', 'preferences.ui-sound-effect')
  translateText('#enable-high-quality-audio', 'preferences.enable-high-quality-audio')
  translateText('#performance-enhancements', 'preferences.performance-enhancements')
  translateText('#performance-enhancements-hint', 'preferences.performance-enhancements-hint')
  translateText('#high-quality-drawing-engine', 'preferences.high-quality-drawing-engine')
  translateText('#high-quality-drawing-engine-hint', 'preferences.high-quality-drawing-engine-hint')
  translateText('#languages', 'preferences.languages')
  translateText('#languages-hint', 'preferences.languages-hint')
  translateText('#open-language-editor', 'preferences.open-language-editor')
  translateText('#sign-out', 'preferences.sign-out')
  translateText('#sign-out-hint', 'preferences.sign-out-hint')
  translateText('#thanks-for-support', 'preferences.thanks-for-support')
  translateText('#additional-features-for-support', 'preferences.additional-features-for-support')
  translateText('#add-watermark', 'preferences.add-watermark')
  translateText('#custom-watermark', 'preferences.custom-watermark')
  translateText('#enable-mcp', 'preferences.enable-mcp')
  translateHtml('#mcp-hint', 'preferences.mcp-hint')
  translateText('#mcp-copy-config', 'preferences.mcp-copy-config')
}

const updatePreference = (name, value) => {
  prefs[name] = value
  api.setPref(name, value).then(result => {
    if (!result || !result.ok) console.error(`Could not update preference ${name}`)
  }).catch(() => console.error(`Could not update preference ${name}`))
}

const onChange = (name, event) => {
  const el = event.target
  if (name === 'enableMcp') {
    api.setMcpEnabled(el.checked).then(result => {
      if (!result || !result.ok) {
        el.checked = false
        prefs.enableMcp = false
        alert('Could not start the MCP service.')
      }
      return refreshData()
    }).catch(() => {
      el.checked = false
      prefs.enableMcp = false
    })
    return
  }
  if (name === 'defaultBoardTiming') {
    const value = el.value === '' ? 2000 : sToMsecs(el.value)
    if (Number.isInteger(value)) updatePreference(name, value)
  } else if (el.type === 'checkbox') {
    updatePreference(name, el.checked)
  } else if (el.type === 'range') {
    updatePreference(name, parseInt(el.value, 10))
  }
  render()
}

const onInput = (name, event) => {
  if (event.target.type === 'range') {
    updatePreference(name, parseInt(event.target.value, 10))
    render()
  }
}

const refreshData = async ({ resetOriginal = false } = {}) => {
  const data = await api.getData()
  if (!data || typeof data !== 'object') throw new Error('Invalid preferences data')
  data.mcpStatus = await api.getMcpStatus().catch(() => ({ enabled: false }))
  viewData = data
  prefs = clone(data.prefs)
  if (resetOriginal) originalPrefs = clone(prefs)
  initializeLanguageList()
  updateHTML()
  render()
}

const onFilenameClick = async event => {
  event.preventDefault()
  event.currentTarget.style.pointerEvents = 'none'
  try {
    const result = await api.selectImageEditor()
    if (!result || !result.ok) alert('Could not select the image editor.')
    await refreshData()
  } catch (err) {
    alert('Could not select the image editor.')
  } finally {
    event.currentTarget.style.pointerEvents = 'auto'
  }
}

const onWatermarkFileClick = async event => {
  event.preventDefault()
  event.currentTarget.style.pointerEvents = 'none'
  try {
    const result = await api.importWatermark()
    if (!result || !result.ok) alert('The selected watermark must be a valid PNG file smaller than 20 MB.')
    await refreshData()
  } catch (err) {
    alert('Could not import the watermark image.')
  } finally {
    event.currentTarget.style.pointerEvents = 'auto'
  }
}

const onRevealKeyMapFileClick = event => {
  event.preventDefault()
  api.revealKeymap().catch(() => {})
}

const onSignOut = async event => {
  event.preventDefault()
  await api.signOut()
  await refreshData()
}

const primitiveChangedPrefs = () => {
  const changed = {}
  for (const key of new Set([...Object.keys(originalPrefs), ...Object.keys(prefs)])) {
    const before = originalPrefs[key]
    const after = prefs[key]
    const isPrimitive = value => value == null || ['string', 'number', 'boolean'].includes(typeof value)
    if (isPrimitive(before) && isPrimitive(after) && before !== after) changed[key] = after
  }
  return changed
}

const render = () => {
  if (!inputs) return
  for (const el of inputs) {
    if (el.type === 'checkbox') {
      el.checked = Boolean(prefs[el.name])
    } else if (el.type === 'number') {
      el.value = el.name === 'defaultBoardTiming' ? msecsToS(prefs[el.name]) : prefs[el.name]
    } else if (el.type === 'range') {
      el.value = prefs[el.name]
    }
  }

  imgEditorInput.value = prefs.absolutePathToImageEditor || ''
  imgEditorEl.textContent = imgEditorInput.value ? truncateMiddle(basename(imgEditorInput.value)) : '(default)'

  const storyboardersAccountEl = document.getElementById('storyboardersAccount')
  if (viewData.accountEmail) {
    storyboardersAccountEl.style.display = 'flex'
    storyboardersAccountEl.querySelector('.preferences-hint').textContent =
      `Signed In to Storyboarders.com (${viewData.accountEmail})`
  } else {
    storyboardersAccountEl.style.display = 'none'
    storyboardersAccountEl.querySelector('.preferences-hint').textContent = ''
  }

  for (const el of document.querySelectorAll('input[type="range"]')) {
    const outEl = document.querySelector(`span[data-value="${el.id}"]`)
    if (!outEl) continue
    if (Number(el.value) < 10) el.value = 0
    outEl.textContent = Number(el.value) >= 10 ? `${el.value} msecs` : 'disabled'
  }

  const watermarkLabelEl = document.querySelector('#watermarkFile_filename')
  if (watermarkLabelEl) {
    watermarkLabelEl.textContent = prefs.userWatermark && viewData.watermarkExists
      ? prefs.userWatermark
      : '(default)'
  }

  const enableNotificationsEl = document.querySelector('#enableNotifications')
  if (enableNotificationsEl) {
    for (const child of [document.querySelector('#enableAspirationalMessages'), document.querySelector('#allowNotificationsForLineMileage')]) {
      if (!child) continue
      child.disabled = !enableNotificationsEl.checked
      child.parentNode.style.opacity = enableNotificationsEl.checked ? 1 : 0.5
    }
  }

  const mcpStatus = viewData.mcpStatus || {}
  if (mcpStatusEl) {
    mcpStatusEl.textContent = mcpStatus.enabled
      ? (translation('preferences.mcp-listening') || 'Listening at {{endpoint}}').replace('{{endpoint}}', mcpStatus.endpoint || '(unknown endpoint)')
      : (translation('preferences.mcp-disabled') || 'MCP service is disabled.')
  }
  if (mcpTokenEl) {
    mcpTokenEl.textContent = mcpStatus.enabled && mcpStatus.token
      ? (translation('preferences.mcp-token') || 'Session token: {{token}}').replace('{{token}}', mcpStatus.token)
      : ''
  }
  if (mcpCopyConfigEl) {
    mcpCopyConfigEl.style.display = mcpStatus.enabled ? 'inline-block' : 'none'
  }

  hasChanged = Object.keys(primitiveChangedPrefs()).length > 0
}

const showDropContent = () => document.getElementById('myDropdown').classList.toggle('show')

window.addEventListener('click', event => {
  if (!event.target.matches('.dropbtn-container')) {
    for (const dropdown of document.getElementsByClassName('dropdown-content')) dropdown.classList.remove('show')
  }
})

const selectLanguage = async language => {
  const result = await api.selectLanguage(language.fileName)
  if (!result || !result.ok) return
  await refreshData()
}

const initializeLanguageList = () => {
  const languages = Array.isArray(viewData.languages) ? viewData.languages : []
  const button = document.getElementsByClassName('dropbtn')[0]
  const buttonContainer = document.getElementsByClassName('dropbtn-container')[0]
  const optionContainer = document.getElementById('myDropdown')
  if (!button || !buttonContainer || !optionContainer) return
  const selectedLanguage = languages.find(item => item.fileName === viewData.selectedLanguage) || languages[0]
  button.textContent = selectedLanguage ? selectedLanguage.displayName : viewData.selectedLanguage
  buttonContainer.onclick = showDropContent
  optionContainer.replaceChildren()
  selectedOption = null
  for (const language of languages) {
    const option = document.createElement('div')
    option.textContent = language.displayName
    if (selectedLanguage && selectedLanguage.fileName === language.fileName) {
      option.classList.add('selected')
      selectedOption = option
    }
    option.onclick = async () => {
      button.textContent = language.displayName
      if (selectedOption) selectedOption.classList.remove('selected')
      option.classList.add('selected')
      selectedOption = option
      await selectLanguage(language)
    }
    optionContainer.appendChild(option)
  }
}

const init = async () => {
  await refreshData({ resetOriginal: true })

  if (viewData.licensed && !document.querySelector('#licensed')) {
    const template = document.querySelector('#licensed-template')
    const fragment = document.importNode(template.content, true)
    document.querySelector('#licensed-container').appendChild(fragment)
  }

  inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"], input[type="range"]')
  imgEditorEl = document.querySelector('#absolutePathToImageEditor_filename')
  imgEditorInput = document.querySelector('#absolutePathToImageEditor')
  revealKeyMapFileEl = document.querySelector('#revealKeyMapFile')
  signOutEl = document.querySelector('#signOut')
  mcpStatusEl = document.querySelector('#mcp-status')
  mcpTokenEl = document.querySelector('#mcp-token')
  mcpCopyConfigEl = document.querySelector('#mcp-copy-config')

  for (const el of inputs) el.addEventListener('change', onChange.bind(null, el.name))
  for (const el of document.querySelectorAll('input[type="range"]')) el.addEventListener('input', onInput.bind(null, el.name))
  imgEditorEl.addEventListener('click', onFilenameClick)
  revealKeyMapFileEl.addEventListener('click', onRevealKeyMapFileClick)
  signOutEl.addEventListener('click', onSignOut)
  if (mcpCopyConfigEl) mcpCopyConfigEl.addEventListener('click', async event => {
    event.preventDefault()
    const status = viewData.mcpStatus || {}
    if (!status.enabled || !status.endpoint || !status.token) return
    const config = JSON.stringify({ url: status.endpoint, headers: { Authorization: `Bearer ${status.token}` } }, null, 2)
    try {
      await navigator.clipboard.writeText(config)
      mcpStatusEl.textContent = translation('preferences.mcp-config-copied') || 'MCP connection config copied.'
    } catch (err) {
      alert(config)
    }
  })
  const languageEditor = document.querySelector('.open-language-editor button')
  if (languageEditor) languageEditor.onclick = event => {
    event.preventDefault()
    api.openLanguagePreferences()
  }
  const watermarkEl = document.querySelector('#watermarkFile_filename')
  if (watermarkEl) watermarkEl.addEventListener('click', onWatermarkFileClick)

  window.ondragover = () => false
  window.ondragleave = () => false
  window.ondragend = () => false
  window.ondrop = () => false
  window.onbeforeunload = () => {
    if (hasChanged) api.notifyChanges(primitiveChangedPrefs())
  }

  api.onLanguageDataChanged(() => refreshData().catch(() => {}))
  initializeLanguageList()
  updateHTML()
  render()
}

init().catch(() => {
  document.body.textContent = 'Could not load preferences.'
})
