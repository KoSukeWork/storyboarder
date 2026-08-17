import React, { Suspense } from 'react'
import ReactDOM from 'react-dom'
import LanguagePreferences from '../../language-preferences'

ReactDOM.render(
  <Suspense fallback="loading">
    <LanguagePreferences />
  </Suspense>,
  document.getElementById('main')
)
