/*
 * Release guard for electron-builder signing.
 *
 * Local `dist:*` commands remain usable for development.  CI/publishing
 * should set REQUIRE_SIGNING=true (the release scripts do this) so a missing
 * certificate cannot silently produce an unsigned update artifact.
 */
const fs = require('fs')
const path = require('path')

if (String(process.env.REQUIRE_SIGNING).toLowerCase() !== 'true') {
  console.log('Signing check skipped (set REQUIRE_SIGNING=true for release builds).')
  process.exit(0)
}

const platform = (process.argv[2] || process.platform).toLowerCase()
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

if (!packageJson.build || packageJson.build.win == null || packageJson.build.win.publisherName !== 'Wonder Unit') {
  throw new Error('Windows publisherName must be configured before publishing')
}

if (platform === 'linux') {
  console.log('Linux artifacts do not require code signing.')
  process.exit(0)
}

if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
  throw new Error(`Signing is explicitly disabled for ${platform}; refusing release build`)
}

// Require an explicit identity or linked certificate for release builds.
// This prevents a CI machine without a keychain from silently emitting an
// unsigned artifact that could later be accepted by an updater.
if (!process.env.CSC_LINK && !process.env.CSC_NAME && !process.env.CSC_IDENTITY) {
  throw new Error(`No ${platform} signing identity configured; set CSC_LINK, CSC_NAME, or CSC_IDENTITY`)
}

console.log(`Signing configuration accepted for ${platform}.`)
