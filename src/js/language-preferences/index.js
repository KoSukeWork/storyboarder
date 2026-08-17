import React, { useEffect, useMemo, useRef, useState } from 'react'
import ItemList from './ItemList'
import JSONEditor from './JsonEditor/JsonEditor'
import Modal from './Modal'

// All filesystem and dialog operations are performed by the main process.
// The preload exposes only this narrowly-scoped API to the page.
const api = () => window.storyboarderLanguagePreferences || {}

const languageList = value => Array.isArray(value) ? value : []
const isValidLanguage = language => language &&
  typeof language.fileName === 'string' && language.fileName.length <= 128 &&
  /^[A-Za-z0-9_-]+$/.test(language.fileName) &&
  typeof language.displayName === 'string' && language.displayName.length <= 256

const validLanguages = value => languageList(value).filter(isValidLanguage)

const LanguagePreferences = React.memo(() => {
  const [selectedJson, setSelectedJson] = useState({ Name: 'Language' })
  const [languages, setLanguages] = useState([])
  const [currentLanguage, setCurrentLanguage] = useState(null)
  const [isEditable, setEditable] = useState(false)
  const [isReady, setReady] = useState(false)
  const [isShowAddModal, showAddModal] = useState(false)
  const [isShowWarningModal, showWarningModal] = useState(false)
  const [warningMessage, setWarningMessage] = useState('')
  const generateLanguageName = useRef('')
  const newLanguageName = useRef('')

  const builtIn = useMemo(
    () => new Set(languages.filter(language => language.builtIn).map(language => language.fileName)),
    [languages]
  )
  const isBuiltInLanguage = language => builtIn.has(language)

  const applyData = data => {
    if (!data || typeof data !== 'object') return
    const nextLanguages = validLanguages(data.languages)
    const selected = typeof data.selectedLanguage === 'string' &&
      nextLanguages.some(language => language.fileName === data.selectedLanguage)
      ? data.selectedLanguage
      : (nextLanguages[0] && nextLanguages[0].fileName)
    setLanguages(nextLanguages)
    setCurrentLanguage(selected || null)
    setEditable(Boolean(selected) && !nextLanguages.some(language => language.fileName === selected && language.builtIn))
    setSelectedJson(data.json && typeof data.json === 'object' && !Array.isArray(data.json)
      ? data.json
      : { Name: 'Language' })
    setReady(true)
  }

  useEffect(() => {
    let active = true
    Promise.resolve(api().getData && api().getData())
      .then(data => { if (active) applyData(data) })
      .catch(() => { if (active) setReady(true) })
    const unsubscribe = api().onLanguageChanged
      ? api().onLanguageChanged(() => {
        if (!active || !api().getData) return
        Promise.resolve(api().getData(currentLanguage)).then(data => { if (active) applyData(data) }).catch(() => {})
      })
      : () => {}
    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isReady || !currentLanguage || !api().getData) return
    let active = true
    Promise.resolve(api().getData(currentLanguage))
      .then(data => {
        if (!active || !data) return
        if (Array.isArray(data.languages)) setLanguages(validLanguages(data.languages))
        if (data.json && typeof data.json === 'object' && !Array.isArray(data.json)) setSelectedJson(data.json)
      })
      .catch(() => {})
    return () => { active = false }
  }, [currentLanguage, isReady])

  const getLanguage = language => languages.find(item => item.fileName === language)

  const onJsonChange = value => {
    if (!isEditable || !currentLanguage || !value || typeof value !== 'object' || Array.isArray(value)) return
    const language = getLanguage(currentLanguage)
    const displayName = typeof value.Name === 'string' && value.Name.length <= 256
      ? value.Name
      : (language && language.displayName) || 'Language'
    const json = { ...value, Name: displayName }
    setSelectedJson(json)
    if (!api().save) return
    Promise.resolve(api().save(currentLanguage, json)).then(result => {
      if (result && result.ok && result.data) applyData(result.data)
    }).catch(() => {})
  }

  const generateNewLanguageName = () => {
    const language = getLanguage(currentLanguage)
    const base = language && language.displayName ? language.displayName : 'Language'
    let newName = `${base} copy`
    let iteration = 1
    while (languages.some(item => item.displayName === newName)) {
      newName = `${base} copy${iteration++}`
    }
    generateLanguageName.current = newName
    newLanguageName.current = newName
  }

  const addNewLanguage = () => {
    const displayName = typeof newLanguageName.current === 'string' && newLanguageName.current.trim()
      ? newLanguageName.current.trim().slice(0, 256)
      : generateLanguageName.current || 'Language copy'
    if (!api().add) return
    Promise.resolve(api().add(displayName, selectedJson)).then(result => {
      if (result && result.ok && result.data) applyData(result.data)
    }).catch(() => {})
  }

  const removeSelectedLanguage = () => {
    if (!currentLanguage) return
    if (isBuiltInLanguage(currentLanguage)) {
      setWarningMessage('You cannot remove built-in language')
    } else {
      setWarningMessage(`Are you sure you want to remove ${removeUUIDFromName(currentLanguage)}`)
    }
    showWarningModal(true)
  }

  const removeUUIDFromName = name => {
    const source = typeof name === 'string' ? name : 'language'
    const splits = source.split('_')
    return (splits.length > 1 ? splits.slice(1).join('_') : splits[0]) || 'language'
  }

  const proceedWithRemoval = () => {
    if (!currentLanguage || isBuiltInLanguage(currentLanguage) || !api().remove) return
    Promise.resolve(api().remove(currentLanguage)).then(result => {
      showWarningModal(false)
      if (result && result.ok && result.data) applyData(result.data)
      else setWarningMessage('The selected language file could not be removed')
    }).catch(() => setWarningMessage('The selected language file could not be removed'))
  }

  const selectLanguage = language => {
    if (!isValidLanguage({ fileName: language, displayName: 'language' }) || !api().select) return
    Promise.resolve(api().select(language)).then(result => {
      if (result && result.ok && result.data) applyData(result.data)
    }).catch(() => {})
  }

  const exportLanguage = () => {
    if (!currentLanguage || !api().export) return
    Promise.resolve(api().export(currentLanguage)).catch(() => {})
  }

  const importLanguage = () => {
    if (!api().import) return
    Promise.resolve(api().import()).then(result => {
      if (result && result.ok && result.data) applyData(result.data)
    }).catch(() => {})
  }

  return (
    <div className="languages-container">
      {isShowWarningModal &&
        <Modal visible={isShowWarningModal} onClose={() => showWarningModal(false)}>
          <div style={{ margin: '5px' }}>{warningMessage}</div>
          {isBuiltInLanguage(currentLanguage) ?
            <div className="modal-selector__div">
              <button className="modal-selector__button" onClick={() => showWarningModal(false)}>Proceed</button>
            </div> :
            <div className="modal-row">
              <div className="modal-selector__div">
                <button className="modal-selector__button" onClick={() => showWarningModal(false)}>Cancel</button>
              </div>
              <div className="modal-selector__div">
                <button className="modal-selector__button" onClick={proceedWithRemoval}>Continue</button>
              </div>
            </div>}
        </Modal>}
      {isShowAddModal &&
        <Modal visible={isShowAddModal} onClose={() => showAddModal(false)}>
          <div style={{ margin: '5px' }}>Set language label:</div>
          <div className="column" style={{ flex: 1 }}>
            <input
              className="modalInput"
              type="text"
              placeholder={generateLanguageName.current}
              onChange={event => { newLanguageName.current = event.currentTarget.value }} />
          </div>
          <div className="modal-selector__div">
            <button className="modal-selector__button" onClick={() => { showAddModal(false); addNewLanguage() }}>Proceed</button>
          </div>
        </Modal>}
      <div className="languages-config">
        <h1 className="config-title">Language Editor</h1>
        <div id="config-intro" style={{ paddingBottom: '20px' }}>Your friendly language editor. Copy, Remove, Import or Export and share with others.</div>
        <ItemList
          languages={languages.map(language => ({ ...language, editable: !language.builtIn }))}
          onSelect={selectLanguage}
          selectedLanguage={currentLanguage} />
        <div className="modify-buttons-container">
          <div className="button" onClick={() => { generateNewLanguageName(); showAddModal(true) }}>+</div>
          <div className="button" onClick={removeSelectedLanguage}>-</div>
        </div>
        <div id="button-content">
          <div className="button-io" onClick={importLanguage}>Import</div>
          <div className="button-io" onClick={exportLanguage}>Export</div>
        </div>
      </div>
      <div className="language-editor">
        {!isEditable &&
          <div className="editor-warning">
            <div className="editor-warning-text">
              This is an installed language. It cannot be edited directly. <br />
              Make a copy of it to start a new language.
            </div>
          </div>}
        <JSONEditor json={selectedJson} onChange={onJsonChange} />
      </div>
    </div>
  )
})

export default LanguagePreferences
