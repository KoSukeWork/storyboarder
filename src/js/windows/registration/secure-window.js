const registration = window.storyboarderRegistration
const SIGN_UP_URI = 'https://app.wonderunit.com/signup'
const state = { token: null, user: null }

const parseJson = body => {
  try { return JSON.parse(body) } catch (err) { return null }
}

const apiRequest = async (path, options = {}) => {
  const result = await registration.request({
    path,
    method: options.method || 'GET',
    token: options.token || state.token,
    body: options.body,
    contentType: options.contentType
  })
  const body = parseJson(result.body)
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Server returned HTTP status code ${result.status}`)
  }
  return body == null ? result.body : body
}

const apiPathFromUrl = value => {
  const url = new URL(value)
  if (url.origin !== 'https://app.wonderunit.com' || !url.pathname.startsWith('/api/')) {
    throw new Error('Payment endpoint is outside the API allow-list')
  }
  return `${url.pathname}${url.search}`
}

const decodeToken = token => {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch (err) {
    return {}
  }
}

const clear = () => { document.body.replaceChildren() }
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

const renderSignIn = async () => {
  clear()
  const form = document.createElement('div')
  form.className = 'registration-window__form'
  addText(form, 'h1', 'Sign In', 'registration-window__title')
  const formEl = document.createElement('form')
  for (const [name, label, type] of [['email', 'Email', 'email'], ['password', 'Password', 'password']]) {
    const row = document.createElement('label')
    row.className = 'registration-window__input'
    addText(row, 'div', label)
    const input = document.createElement('input')
    input.name = name
    input.type = type
    input.required = true
    row.appendChild(input)
    formEl.appendChild(row)
  }
  const button = document.createElement('button')
  button.className = 'registration-window__button'
  button.type = 'submit'
  button.textContent = 'Sign In'
  formEl.appendChild(button)
  const hint = addText(form, 'p', 'Need an account?', 'registration-window__hint')
  const signUp = document.createElement('a')
  signUp.href = SIGN_UP_URI
  signUp.textContent = ' Sign Up'
  signUp.addEventListener('click', event => {
    event.preventDefault()
    registration.openExternal(SIGN_UP_URI)
  })
  hint.appendChild(signUp)
  form.appendChild(formEl)
  document.body.appendChild(form)
  formEl.addEventListener('submit', async event => {
    event.preventDefault()
    button.disabled = true
    button.textContent = 'Signing In …'
    try {
      const body = new URLSearchParams({
        email: formEl.elements.email.value,
        password: formEl.elements.password.value
      }).toString()
      const response = await apiRequest('/users/authenticate', {
        method: 'POST',
        body,
        contentType: 'application/x-www-form-urlencoded'
      })
      if (!response || !response.token) throw new Error('No token returned by server')
      state.token = response.token
      state.user = decodeToken(state.token)
      registration.signInSuccess(response)
      await renderHome()
    } catch (error) {
      showError(error)
      button.disabled = false
      button.textContent = 'Sign In'
    }
  })
}

const installLicense = subscriptionId => {
  clear()
  const wrapper = document.createElement('div')
  wrapper.className = 'registration-window__form'
  addText(wrapper, 'h1', 'Installing License', 'registration-window__title')
  const output = addText(wrapper, 'div', '', 'registration-window__subhead')
  output.style.lineHeight = '1.5'
  document.body.appendChild(wrapper)
  const progress = message => { output.appendChild(document.createTextNode(message)); output.appendChild(document.createElement('br')) }
  ;(async () => {
    try {
      progress('Requesting License Grant …')
      await registration.installLicense({ token: state.token, subscriptionId })
      progress('Done! Please restart Storyboarder to finish installation.')
    } catch (error) {
      progress('Server Error :(')
      showError(error)
    }
  })()
}

const renderHome = async () => {
  clear()
  const wrapper = document.createElement('div')
  wrapper.className = 'registration-window__form'
  addText(wrapper, 'h1', 'Hello!', 'registration-window__title')
  addText(wrapper, 'p', 'Thank you for supporting Storyboarder.')
  const status = await registration.hasLicense()
  if (status) addText(wrapper, 'p', 'This machine has a Storyboarder license installed.')
  const subscriptions = await apiRequest('/subscriptions')
  const list = (Array.isArray(subscriptions) ? subscriptions : []).filter(item => item.stripe_status !== 'canceled')
  if (list.length) {
    addText(wrapper, 'p', 'Your subscriptions:')
    for (const subscription of list) {
      const button = document.createElement('button')
      button.className = 'registration-window__button'
      button.textContent = `Install subscription ${subscription.subscription_id}`
      button.addEventListener('click', () => installLicense(String(subscription.subscription_id)))
      wrapper.appendChild(button)
    }
  } else {
    addText(wrapper, 'p', 'No active subscription was found.')
    try {
      const products = await apiRequest('/products')
      const product = Array.isArray(products) && products.find(item => item.name === 'Storyboarder')
      if (product && window.StripeCheckout) {
        const plans = await apiRequest(`/plans?product_id=${encodeURIComponent(product.product_id)}`)
        const forms = await Promise.all((Array.isArray(plans) ? plans : []).map(plan =>
          apiRequest(`/payment-form?product_id=${encodeURIComponent(product.product_id)}&plan_id=${encodeURIComponent(plan.plan_id)}`)
        ))
        for (const form of forms) {
          const button = document.createElement('button')
          button.className = 'registration-window__button'
          button.textContent = String(form.label || 'Subscribe')
          const handler = StripeCheckout.configure({
            key: form.stripePublishableKey,
            image: form.image,
            locale: 'auto',
            token: async token => {
              button.disabled = true
              try {
                const payment = await apiRequest(apiPathFromUrl(form.action), {
                  method: 'POST',
                  body: {
                    stripeToken: token.id,
                    user_id: state.user.user_id,
                    product_id: form.product.product_id,
                    plan_id: form.plan.plan_id
                  }
                })
                window.alert('Approved! Thanks for your support!')
                installLicense(String(payment.subscription_id))
              } catch (error) {
                showError(error)
                button.disabled = false
              }
            }
          })
          button.addEventListener('click', event => {
            event.preventDefault()
            handler.open({
              name: String(form.name || 'Storyboarder'),
              description: String(form.description || ''),
              amount: Number(form.amount) || 0
            })
          })
          wrapper.appendChild(button)
        }
      }
    } catch (error) {
      showError(error)
    }
  }
  const signOut = document.createElement('button')
  signOut.className = 'registration-window__button'
  signOut.textContent = 'Sign Out'
  signOut.addEventListener('click', () => {
    state.token = null
    state.user = null
    renderSignIn()
  })
  wrapper.appendChild(signOut)
  if (status) {
    const remove = document.createElement('button')
    remove.className = 'registration-window__button'
    remove.textContent = 'Remove license from this machine'
    remove.addEventListener('click', async () => {
      if (!window.confirm('Are you sure you want to remove this license key from this machine?')) return
      await registration.removeLicense()
      window.alert('License removed. Please restart Storyboarder.')
      registration.hide()
    })
    wrapper.appendChild(remove)
  }
  document.body.appendChild(wrapper)
}

setTimeout(() => renderSignIn().catch(showError), 100)
