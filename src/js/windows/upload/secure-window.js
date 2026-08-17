const upload = window.storyboarderUpload
const SIGN_UP_URI = 'https://storyboarders.com/signup'

const parseJson = body => {
  try { return JSON.parse(body) } catch (err) { return null }
}

const addText = (parent, tag, text, className) => {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = text == null ? '' : String(text)
  parent.appendChild(element)
  return element
}

const showError = error => {
  console.error(error)
  window.alert(error && error.message ? error.message : 'An error occurred')
}

const createForm = () => {
  const wrapper = document.createElement('div')
  wrapper.className = 'upload-window__form'
  addText(wrapper, 'h1', 'Sign In', 'upload-window__title')

  const form = document.createElement('form')
  const fieldset = document.createElement('fieldset')
  fieldset.className = 'upload-window__fieldset'
  for (const [name, label, type] of [['email', 'Email', 'email'], ['password', 'Password', 'password']]) {
    const row = document.createElement('label')
    row.className = 'upload-window__input'
    addText(row, 'div', label)
    const input = document.createElement('input')
    input.name = name
    input.type = type
    input.required = true
    row.appendChild(input)
    fieldset.appendChild(row)
  }

  const button = document.createElement('button')
  button.className = 'upload-window__button'
  button.type = 'submit'
  button.textContent = 'Sign In'
  fieldset.appendChild(button)
  form.appendChild(fieldset)

  const hint = addText(wrapper, 'p', 'Need an account?', 'upload-window__hint')
  const signUp = document.createElement('a')
  signUp.href = SIGN_UP_URI
  signUp.textContent = ' Sign up at Storyboarders.com'
  signUp.addEventListener('click', event => {
    event.preventDefault()
    upload.openExternal(SIGN_UP_URI)
  })
  hint.appendChild(signUp)
  wrapper.insertBefore(form, hint)

  form.addEventListener('submit', async event => {
    event.preventDefault()
    button.disabled = true
    button.textContent = 'Signing In …'
    try {
      const result = await upload.login({
        email: form.elements.email.value,
        password: form.elements.password.value
      })
      const response = parseJson(result.body)
      if (result.status < 200 || result.status >= 300) {
        const error = new Error(result.status === 403
          ? 'That email/password combination was not accepted.'
          : 'Could not sign in.')
        error.statusCode = result.status
        throw error
      }
      if (!response || typeof response.token !== 'string') throw new Error('No token returned by server')
      upload.signInSuccess(response)
      upload.hide()
    } catch (error) {
      showError(error)
      button.disabled = false
      button.textContent = 'Sign In'
    }
  })

  return wrapper
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    upload.hide()
  }
})
document.body.appendChild(createForm())
