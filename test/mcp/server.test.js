const assert = require('assert')

const { StoryboarderMcpService } = require('../../src/js/mcp/server')

const request = async (endpoint, token, body, headers = {}) => fetch(endpoint, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...headers
  },
  body: JSON.stringify(body)
})

const readSseJson = async response => {
  const text = await response.text()
  const line = text.split('\n').find(value => value.startsWith('data: '))
  return line ? JSON.parse(line.slice(6)) : null
}

describe('Storyboarder MCP service', function () {
  this.timeout(10000)
  let service
  let info

  beforeEach(async () => {
    service = new StoryboarderMcpService({
      appVersion: 'test',
      bridge: {
        request: async (operation, payload) => ({ ok: true, operation, payload })
      }
    })
    info = await service.start()
  })

  afterEach(async () => service.stop())

  it('binds to loopback and requires the session token', async () => {
    assert.strictEqual(info.host, '127.0.0.1')
    const response = await fetch(info.endpoint, { method: 'POST', body: '{}' })
    assert.strictEqual(response.status, 401)
  })

  it('serves MCP initialization and the registered tool catalog', async () => {
    const initialize = await request(info.endpoint, info.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    })
    assert.strictEqual(initialize.status, 200)
    const sessionId = initialize.headers.get('mcp-session-id')
    assert(sessionId)
    await initialize.text()

    const tools = await request(info.endpoint, info.token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    }, { 'mcp-session-id': sessionId })
    assert.strictEqual(tools.status, 200)
    const body = await readSseJson(tools)
    const names = body.result.tools.map(tool => tool.name)
    assert(names.includes('storyboarder_get_context'))
    assert(names.includes('storyboarder_propose_image_import'))
    assert(names.includes('storyboarder_export'))
  })

  it('rejects non-loopback origins', async () => {
    const response = await request(info.endpoint, info.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }, { origin: 'https://attacker.example' })
    assert.strictEqual(response.status, 403)
  })

  it('rotates the token on restart and rejects unknown content types', async () => {
    const firstToken = info.token
    await service.stop()
    info = await service.start()
    assert.notStrictEqual(info.token, firstToken)
    const response = await fetch(info.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'text/plain' },
      body: '{}'
    })
    assert.strictEqual(response.status, 415)
  })
})
