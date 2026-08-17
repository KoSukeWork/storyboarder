const randomBytes = size => {
  const bytes = new Uint8Array(size)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  return typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes
}
module.exports = { randomBytes, createHash: () => ({ update: () => this, digest: () => '' }) }
