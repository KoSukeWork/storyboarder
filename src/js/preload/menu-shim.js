const bridge = window.storyboarderMain
const sendMenuEvent = (channel, ...args) => bridge.ipc.send(channel, ...args)

module.exports = {
  setMenu: () => sendMenuEvent('menu:setMenu'),
  setWelcomeMenu: () => sendMenuEvent('menu:setWelcomeMenu'),
  setMainMenu: () => sendMenuEvent('menu:setMenu'),
  setPrintProjectMenu: () => sendMenuEvent('menu:setPrintProjectMenu'),
  setEnableAudition: value => sendMenuEvent('menu:setEnableAudition', Boolean(value)),
  send: (channel, ...args) => bridge.ipc.send(channel, ...args)
}
