const pathToFileURL = value => new URL(`file://${String(value).replace(/\\/g, '/')}`)
const parse = value => {
  const parsed = new URL(String(value), typeof location !== 'undefined' ? location.href : 'file:///')
  return {
    protocol: parsed.protocol,
    slashes: Boolean(parsed.host),
    auth: parsed.username ? `${parsed.username}:${parsed.password}` : null,
    host: parsed.host,
    hostname: parsed.hostname,
    hash: parsed.hash || null,
    search: parsed.search || null,
    pathname: parsed.pathname,
    path: `${parsed.pathname}${parsed.search}`,
    href: parsed.href
  }
}
const resolve = (from, to) => new URL(String(to), String(from)).toString()
module.exports = { pathToFileURL, URL, URLSearchParams, parse, resolve, format: value => value && value.href || String(value || '') }
