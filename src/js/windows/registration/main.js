const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const trash = require('trash')
const { machineIdSync } = require('node-machine-id')
const { resolveForWriteInside } = require('../../utils/security')

const API_ROOT = 'https://app.wonderunit.com/api'
const getLicenseKeyPath = () => resolveForWriteInside(app.getPath('userData'), 'license.key')
const MAX_REQUEST_BODY_LENGTH = 64 * 1024
const MAX_RESPONSE_LENGTH = 2 * 1024 * 1024
const ALLOWED_CONTENT_TYPES = new Set([
  'application/json',
  'application/x-www-form-urlencoded'
])
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'app.wonderunit.com',
  'checkout.stripe.com',
  'js.stripe.com'
])

let win
let hasRendered = false

const assertRegistrationSender = event => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) {
    throw new Error('Unauthorized registration IPC sender')
  }
}

const reveal = () => {
  if (hasRendered) {
    win.show()
    win.focus()
  } else {
    hasRendered = true
    // wait for the DOM to render
    setTimeout(() => {
      win.show()
      win.focus()
    }, 125)
  }
}

const show = () => {
  if (win) {
    reveal()
    return
  }

  win = new BrowserWindow({
    width: 600,
    height: 720,
    minWidth: 600,
    minHeight: 720,
    show: false,
    center: true,
    resizable: false,
    backgroundColor: '#E5E5E5',
    frame: true,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/registration.js'),
      nodeIntegration: false,
      devTools: true,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-redirect', event => event.preventDefault())
  win.once('closed', () => {
    win = null
  })
  win.loadFile(path.join(__dirname, '../../../registration.html'))
  win.once('ready-to-show', () => {
    reveal()
  })
}

const assertRequestPath = value => {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || /[\0\r\n]/.test(value)) {
    throw new Error('Invalid registration request')
  }
  const url = new URL(`${API_ROOT}${value}`)
  if (url.origin !== 'https://app.wonderunit.com' || !url.pathname.startsWith('/api/')) {
    throw new Error('Registration request is outside the API allow-list')
  }
  return url
}

ipcMain.handle('registration:request', async (event, request = {}) => {
  assertRegistrationSender(event)
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Invalid registration request')
  }
  const url = assertRequestPath(request.path)
  const method = ['GET', 'POST'].includes(request.method) ? request.method : 'GET'
  const contentType = request.contentType == null ? undefined : String(request.contentType)
  if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error('Unsupported registration request content type')
  }
  if (method === 'GET' && request.body != null) throw new Error('GET requests cannot contain a body')
  const headers = {}
  if (request.token != null) {
    if (typeof request.token !== 'string' || request.token.length > 4096) throw new Error('Invalid registration token')
    headers.Authorization = `Bearer ${request.token}`
  }
  let body
  if (request.body != null) {
    headers['Content-Type'] = contentType || 'application/json'
    body = contentType === 'application/x-www-form-urlencoded'
      ? String(request.body)
      : JSON.stringify(request.body)
    if (body.length > MAX_REQUEST_BODY_LENGTH) throw new Error('Registration request body is too large')
  }
  const response = await fetch(url, { method, headers, body, redirect: 'error' })
  const responseBody = await response.text()
  return { status: response.status, body: responseBody.slice(0, MAX_RESPONSE_LENGTH) }
})

ipcMain.handle('registration:has-license', event => {
  assertRegistrationSender(event)
  try {
    return fs.existsSync(getLicenseKeyPath())
  } catch (err) {
    return false
  }
})

ipcMain.handle('registration:remove-license', async event => {
  assertRegistrationSender(event)
  try {
    const licenseKeyPath = getLicenseKeyPath()
    if (fs.existsSync(licenseKeyPath)) await trash(licenseKeyPath)
  } catch (err) {
    throw new Error('Could not remove the license key')
  }
  return true
})

ipcMain.handle('registration:install-license', async (event, request = {}) => {
  assertRegistrationSender(event)
  if (
    !request ||
    typeof request.token !== 'string' || request.token.length > 4096 ||
    typeof request.subscriptionId !== 'string' ||
    request.subscriptionId.length === 0 || request.subscriptionId.length > 256 ||
    /[\0\r\n]/.test(request.subscriptionId)
  ) {
    throw new Error('Invalid license request')
  }
  const token = request.token.slice(0, 4096)
  let decoded
  try {
    decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch (err) {
    throw new Error('Invalid authentication token')
  }
  if (typeof decoded.user_id !== 'string' || decoded.user_id.length > 256) {
    throw new Error('Authentication token has no user id')
  }

  const grantResponse = await fetch(`${API_ROOT}/licenses`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      user_id: decoded.user_id,
      machine_id: machineIdSync({ original: true }),
      subscription_id: request.subscriptionId
    })
  })
  if (grantResponse.status !== 200) throw new Error('Could not obtain license grant')
  const license = await grantResponse.json()
  if (!license || typeof license.license_id !== 'string' ||
    license.license_id.length === 0 || license.license_id.length > 256 ||
    /[\0\r\n]/.test(license.license_id)) {
    throw new Error('License grant was invalid')
  }
  const keyResponse = await fetch(`${API_ROOT}/licenses/${encodeURIComponent(license.license_id)}/license.key`, {
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (keyResponse.status !== 200) throw new Error('Could not install license key')
  const key = await keyResponse.text()
  if (!key || key.length > 256 * 1024) throw new Error('License key response was invalid')
  const licenseKeyPath = getLicenseKeyPath()
  fs.writeFileSync(licenseKeyPath, key, { encoding: 'utf8', mode: 0o600 })
  return true
})

ipcMain.on('registration:hide', event => {
  try {
    assertRegistrationSender(event)
  } catch (err) {
    return
  }
  const registrationWindow = BrowserWindow.fromWebContents(event.sender)
  registrationWindow && registrationWindow.hide()
})

ipcMain.handle('shell:open-external', (event, value) => {
  assertRegistrationSender(event)
  const url = new URL(value)
  if (url.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('External link is not allow-listed')
  }
  return shell.openExternal(url.toString())
})

module.exports = {
  show,
  getWindow: () => win
}
