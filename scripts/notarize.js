/*
 * notarize for macOS
 *   via https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application
 * 
 * to configure, create an `electron-builder.env` with:
 *   APPLEID=...
 *   APPLEIDPASS=...
 * electron-builder will load these automatically before running this script
 * 
 * to skip signing and notarizing during development, use this env var:
 *   CSC_IDENTITY_AUTO_DISCOVERY=false
 *
 */

console.log('  + scripts/notarize.js')

if (
  process.env.hasOwnProperty('CSC_IDENTITY_AUTO_DISCOVERY') &&
  process.env.CSC_IDENTITY_AUTO_DISCOVERY == 'false'
) {
  console.log('    ... skipped because CSC_IDENTITY_AUTO_DISCOVERY was false')
  exports.default = async function notarizing (context) {}
} else {
  exports.default = async function notarizing (context) {
    if (context.electronPlatformName !== 'darwin') {
      console.log('    ... skipped because platform is not darwin')
      return
    }



    const { notarize } = require('electron-notarize')



    let { appOutDir } = context
    let appName = context.packager.appInfo.productFilename
    let {
      APPLEID,
      APPLEIDPASS,
    } = process.env

    if (!APPLEID || !APPLEIDPASS) {
      throw new Error('APPLEID and APPLEIDPASS are required for macOS notarization')
    }

    let config = {
      appBundleId: context.packager.appInfo.id,
      appPath: `${appOutDir}/${appName}.app`,
      appleId: APPLEID,
      appleIdPassword: APPLEIDPASS,
    }

    console.log(`      • notarizing ${appName} (credentials redacted)`)

    return await notarize(config)
  }
}
