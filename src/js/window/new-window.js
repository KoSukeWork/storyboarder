const api = window.storyboarderNewWindow

//#region Localization
let translations = {}

const translateTextWithBreaks = (elementName, translationKey) => {
  let elem = document.querySelector(elementName)
  if(!elem) return
  const value = translations[translationKey]
  if (typeof value !== 'string') return
  elem.replaceChildren()
  value.split('\n').forEach((text, index, lines) => {
    elem.appendChild(document.createTextNode(text))
    if (index < lines.length - 1) elem.appendChild(document.createElement('br'))
  })
}

const updateHTMLText = () => {
  translateTextWithBreaks("#creation-title", "new-window.creation-title")
  translateTextWithBreaks("#script-based-title", "new-window.script-based-title")
  translateTextWithBreaks("#script-based-description", "new-window.script-based-description")
  translateTextWithBreaks("#blank-title", "new-window.blank-title")
  translateTextWithBreaks("#blank-description", "new-window.blank-description")
  translateTextWithBreaks("#new-script", "new-window.new-script")
  translateTextWithBreaks("#new-blank", "new-window.new-blank")
  translateTextWithBreaks("#aspect-title", "new-window.aspect-title")
  translateTextWithBreaks("#aspect-ultrawide", "new-window.aspect-ultrawide")
  translateTextWithBreaks("#aspect-doublewide", "new-window.aspect-doublewide")
  translateTextWithBreaks("#aspect-wide", "new-window.aspect-wide")
  translateTextWithBreaks("#aspect-hd", "new-window.aspect-hd")
  translateTextWithBreaks("#aspect-vertical-hd", "new-window.aspect-vertical-hd")
  translateTextWithBreaks("#aspect-square", "new-window.aspect-square")
  translateTextWithBreaks("#aspect-old", "new-window.aspect-old")
  translateTextWithBreaks("#aspect-description", "new-window.aspect-description")
}

const refreshTranslations = async () => {
  try {
    const data = await api.getData()
    translations = data && data.translations && typeof data.translations === 'object'
      ? data.translations
      : {}
    updateHTMLText()
  } catch (err) {
    console.error('Could not load new-window translations')
  }
}

api.onLanguageChanged(refreshTranslations)
window.addEventListener('focus', () => api.setWelcomeMenu())
refreshTranslations()
//#endregion
// close
document.querySelector('#close-button').addEventListener('click', e => {
  api.playSfx('negative')
  api.hide()
})

// new script-based
document.querySelector('#new-script').addEventListener('click', () => {
  api.openDialogue()
})

document.querySelector('#new-script').addEventListener("mouseover", () =>{
  api.playSfx('rollover')
})

document.querySelector('#new-script').addEventListener("pointerdown", () => {
  api.playSfx('down')
})

// new blank
document.querySelector('#new-blank').addEventListener('click', () => {
  // switch tabs
  document.querySelectorAll('.tab')[0].style.display = 'none'
  document.querySelectorAll('.tab')[1].style.display = 'block'
})

document.querySelector('#new-blank').addEventListener("mouseover", () => {
  api.playSfx('rollover')
})

document.querySelector('#new-blank').addEventListener("pointerdown", () => {
  api.playSfx('down')
})

window.ondragover = () => { return false }
window.ondragleave = () => { return false }
window.ondragend = () => { return false }
window.ondrop = () => { return false }

document.querySelectorAll('.example').forEach(el => {
  el.addEventListener('click', event => {
    api.createNew(el.dataset.aspectRatio)
    event.preventDefault()
  })
})

const setTab = index => {
  document.querySelectorAll('.tab').forEach(el => el.style.display = 'none')
  document.querySelectorAll('.tab')[index].style.display = 'block'
}

api.onSetTab(setTab)

// start on tab 0
setTab(0)
