module.exports = {
  platform: () => (window.storyboarderMain && window.storyboarderMain._internal.process.platform) || 'win32',
  homedir: () => '.',
  tmpdir: () => '.',
  EOL: '\n',
  hostname: () => 'storyboarder',
  constants: { signals: {}, errno: {} },
  endianness: () => 'LE',
  release: () => '',
  type: () => 'Storyboarder',
  arch: () => 'x64'
}
