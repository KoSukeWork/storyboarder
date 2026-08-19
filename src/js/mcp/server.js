const crypto = require('crypto')
const http = require('http')

const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js')
const z = require('zod/v4')

const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 64 * 1024 * 1024
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg'])
const ALLOWED_IMAGE_LAYERS = new Set(['reference', 'fill', 'tone', 'pencil', 'ink', 'notes'])
const ALLOWED_EXPORT_FORMATS = new Set(['pdf', 'images', 'gif', 'video', 'fcpxml', 'zip'])

class McpBridgeError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'McpBridgeError'
    this.code = code
  }
}

const jsonContent = value => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

const errorResult = error => ({
  isError: true,
  content: jsonContent({
    ok: false,
    code: error && typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR',
    message: error && error.message ? error.message : 'MCP request failed'
  })
})

const successResult = value => ({
  content: jsonContent(value),
  structuredContent: value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
})

const isLoopbackAddress = value =>
  value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'

const isAllowedOrigin = value => {
  if (!value) return true
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  } catch (err) {
    return false
  }
}

const hasBearerToken = (request, expectedToken) => {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

const readJsonBody = request => new Promise((resolve, reject) => {
  const chunks = []
  let length = 0
  let tooLarge = false

  request.on('data', chunk => {
    length += chunk.length
    if (length > MAX_BODY_BYTES) {
      tooLarge = true
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    if (tooLarge) {
      const error = new McpBridgeError('VALIDATION_FAILED', 'Request body is too large')
      error.httpStatus = 413
      reject(error)
      return
    }
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      resolve(text ? JSON.parse(text) : undefined)
    } catch (err) {
      const error = new McpBridgeError('VALIDATION_FAILED', 'Request body is not valid JSON')
      error.httpStatus = 400
      reject(error)
    }
  })
  request.on('error', reject)
})

const sendJsonError = (response, status, message, code = -32000) => {
  if (response.headersSent) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null
  }))
}

const boardDraftSchema = z.object({
  action: z.string().max(65536).optional(),
  dialogue: z.string().max(65536).optional(),
  notes: z.string().max(65536).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  newShot: z.boolean().optional()
}).strict()

const imageSourceSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg']),
  dataBase64: z.string().min(1).max(Math.ceil(20 * 1024 * 1024 * 4 / 3) + 16)
}).strict()

const imageTargetSchema = z.union([
  z.object({
    boardUid: z.string().min(1).max(128),
    layer: z.enum(['reference', 'fill', 'tone', 'pencil', 'ink', 'notes']).default('reference')
  }).strict(),
  z.object({
    insertAfterUid: z.string().min(1).max(128).nullable().optional(),
    layer: z.enum(['reference', 'fill', 'tone', 'pencil', 'ink', 'notes']).default('reference'),
    board: boardDraftSchema.optional()
  }).strict()
])

const writeBaseSchema = {
  baseRevision: z.number().int().min(0),
  reason: z.string().max(4096).optional()
}

const ensureBridgeResult = result => {
  if (result && result.ok === false) {
    throw new McpBridgeError(result.code || 'INTERNAL_ERROR', result.message || 'Storyboarder rejected the request')
  }
  return result
}

const resourceJson = (uri, value) => ({
  contents: [{
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(value, null, 2)
  }]
})

const addConnectionState = (value, endpoint) => value && typeof value === 'object' && !Array.isArray(value)
  ? {
      ...value,
      connection: {
        transport: 'streamable-http',
        host: HOST,
        endpoint: endpoint || null,
        authenticated: true
      }
    }
  : value

class StoryboarderMcpService {
  constructor ({ bridge, appVersion, logger = console }) {
    if (!bridge || typeof bridge.request !== 'function') throw new Error('A Storyboarder MCP bridge is required')
    this.bridge = bridge
    this.appVersion = appVersion
    this.logger = logger
    this.httpServer = null
    this.port = null
    this.token = null
    this.sessions = new Map()
  }

  getInfo () {
    return {
      enabled: Boolean(this.httpServer),
      host: HOST,
      port: this.port,
      endpoint: this.port ? `http://${HOST}:${this.port}/mcp` : null,
      token: this.token
    }
  }

  async start () {
    if (this.httpServer) return this.getInfo()

    this.token = crypto.randomBytes(32).toString('base64url')
    this.httpServer = http.createServer((request, response) => {
      this._handleHttpRequest(request, response).catch(error => {
        this.logger.warn(`MCP HTTP request failed: ${error.message}`)
        sendJsonError(response, error.httpStatus || 500, error.httpStatus ? error.message : 'Internal server error', -32603)
      })
    })

    await new Promise((resolve, reject) => {
      const onError = error => {
        this.httpServer = null
        this.port = null
        this.token = null
        reject(error)
      }
      this.httpServer.once('error', onError)
      this.httpServer.listen(0, HOST, () => {
        this.httpServer.removeListener('error', onError)
        resolve()
      })
    })

    this.port = this.httpServer.address().port
    return this.getInfo()
  }

  async stop () {
    const sessions = Array.from(this.sessions.values())
    this.sessions.clear()
    await Promise.all(sessions.map(async session => {
      try { await session.transport.close() } catch (err) {}
      try { await session.server.close() } catch (err) {}
    }))

    if (this.httpServer) {
      const server = this.httpServer
      this.httpServer = null
      await new Promise(resolve => server.close(() => resolve()))
    }
    this.port = null
    this.token = null
  }

  async notifyResourcesChanged () {
    await Promise.all(Array.from(this.sessions.values()).map(async ({ server }) => {
      try {
        const update = server.server && server.server.sendResourceUpdated
        if (typeof update === 'function') {
          for (const uri of ['storyboarder://session', 'storyboarder://project/script', 'storyboarder://scene/current', 'storyboarder://project/shot-list']) {
            await update.call(server.server, { uri })
          }
        }
        await server.sendResourceListChanged()
      } catch (err) {}
    }))
  }

  _createMcpServer () {
    const server = new McpServer({
      name: 'storyboarder-desktop',
      version: this.appVersion
    }, {
      capabilities: { logging: {} },
      instructions: 'Read the current Storyboarder project before proposing edits. All write tools require the latest revision and are confirmed inside Storyboarder.'
    })

    const readJsonResource = (name, uri, description) => {
      server.registerResource(name, uri, {
        title: name,
        description,
        mimeType: 'application/json'
      }, async resourceUri => {
        let result = ensureBridgeResult(await this.bridge.request('read-resource', { uri: resourceUri.href }))
        if (resourceUri.href === 'storyboarder://session') result = addConnectionState(result, this.getInfo().endpoint)
        return resourceJson(resourceUri.href, result)
      })
    }

    readJsonResource('Storyboarder session', 'storyboarder://session', 'Current app, project, selection, capability, and revision state.')
    readJsonResource('Project script', 'storyboarder://project/script', 'Parsed Fountain or Final Draft script for the open project.')
    readJsonResource('Current scene', 'storyboarder://scene/current', 'Current scene settings and board summaries.')
    readJsonResource('Project shot list', 'storyboarder://project/shot-list', 'Camera setups and shot list for the open project.')

    server.registerResource('Storyboard board', new ResourceTemplate('storyboarder://board/{uid}', { list: undefined }), {
      description: 'Metadata and media manifest for one board.',
      mimeType: 'application/json'
    }, async (uri, variables) => {
      const result = ensureBridgeResult(await this.bridge.request('get-board', { uid: variables.uid }))
      return resourceJson(uri.href, result)
    })

    server.registerResource('Storyboard board image', new ResourceTemplate('storyboarder://board/{uid}/image/{kind}', { list: undefined }), {
      description: 'Thumbnail, composite, or named layer image for one board.'
    }, async (uri, variables) => {
      const result = ensureBridgeResult(await this.bridge.request('get-board-image', {
        uid: variables.uid,
        kind: variables.kind
      }))
      return {
        contents: [{
          uri: uri.href,
          mimeType: result.mimeType,
          blob: result.dataBase64
        }]
      }
    })

    const registerReadTool = (name, description, inputSchema, operation, { image = false } = {}) => {
      server.registerTool(name, {
        description,
        inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      }, async args => {
        try {
          let result = ensureBridgeResult(await this.bridge.request(operation, args || {}))
          if (operation === 'get-context') result = addConnectionState(result, this.getInfo().endpoint)
          return image
            ? { content: [{ type: 'image', mimeType: result.mimeType, data: result.dataBase64 }] }
            : successResult(result)
        } catch (error) {
          return errorResult(error)
        }
      })
    }

    registerReadTool('storyboarder_get_context', 'Get the current project, scene, selection, timing settings, capabilities, and revision.', {}, 'get-context')
    registerReadTool('storyboarder_list_scenes', 'List scenes in the currently open script project.', {
      includeCompleted: z.boolean().optional().default(true)
    }, 'list-scenes')
    registerReadTool('storyboarder_list_boards', 'List and filter boards in the current scene.', {
      uids: z.array(z.string().min(1).max(128)).max(10000).optional(),
      text: z.string().max(4096).optional(),
      newShotOnly: z.boolean().optional(),
      includeShotGenerator: z.boolean().optional().default(false)
    }, 'list-boards')
    registerReadTool('storyboarder_get_board', 'Get metadata and media manifest for one board.', {
      uid: z.string().min(1).max(128)
    }, 'get-board')
    registerReadTool('storyboarder_get_board_image', 'Get a board thumbnail, composite, or named layer as image content.', {
      uid: z.string().min(1).max(128),
      kind: z.enum(['thumbnail', 'composite', 'reference', 'fill', 'tone', 'pencil', 'ink', 'notes', 'shot-generator'])
    }, 'get-board-image', { image: true })
    registerReadTool('storyboarder_inspect_project', 'Inspect the current project for invalid data and missing media.', {}, 'inspect-project')
    registerReadTool('storyboarder_get_shot_list', 'Get camera setups, shots, and beats for the current scene or project.', {
      scope: z.enum(['scene', 'project']).optional().default('scene')
    }, 'get-shot-list')
    registerReadTool('storyboarder_focus', 'Focus a scene or board in the Storyboarder UI without modifying project files.', {
      sceneId: z.string().max(256).optional(),
      boardUid: z.string().max(128).optional()
    }, 'focus')

    const registerWriteTool = (name, description, inputSchema, operation, destructiveHint) => {
      server.registerTool(name, {
        description,
        inputSchema,
        annotations: { readOnlyHint: false, destructiveHint, openWorldHint: false }
      }, async args => {
        try {
          const result = ensureBridgeResult(await this.bridge.request(operation, args || {}, { write: true, timeoutMs: 5 * 60 * 1000 }))
          return successResult(result)
        } catch (error) {
          return errorResult(error)
        }
      })
    }

    registerWriteTool('storyboarder_propose_board_draft', 'Preview and, after in-app approval, insert structured board drafts.', {
      ...writeBaseSchema,
      insertAfterUid: z.string().min(1).max(128).nullable().optional(),
      boards: z.array(boardDraftSchema).min(1).max(1000)
    }, 'propose-board-draft', false)

    registerWriteTool('storyboarder_propose_board_updates', 'Preview and, after in-app approval, update board text, duration, and shot boundaries.', {
      ...writeBaseSchema,
      updates: z.array(z.object({
        uid: z.string().min(1).max(128),
        set: boardDraftSchema
      }).strict()).min(1).max(1000)
    }, 'propose-board-updates', false)

    registerWriteTool('storyboarder_propose_reorder', 'Preview and, after in-app approval, replace the current scene board order.', {
      ...writeBaseSchema,
      orderedBoardUids: z.array(z.string().min(1).max(128)).min(1).max(100000)
    }, 'propose-reorder', false)

    registerWriteTool('storyboarder_propose_delete', 'Preview and, after in-app approval, delete boards while preserving at least one board.', {
      ...writeBaseSchema,
      boardUids: z.array(z.string().min(1).max(128)).min(1).max(10000)
    }, 'propose-delete', true)

    registerWriteTool('storyboarder_propose_image_import', 'Preview and, after in-app approval, import inline PNG/JPEG images into board layers.', {
      ...writeBaseSchema,
      items: z.array(z.object({
        source: imageSourceSchema,
        target: imageTargetSchema
      }).strict()).min(1).max(50),
      fit: z.literal('contain').optional().default('contain')
    }, 'propose-image-import', false)

    registerWriteTool('storyboarder_export', 'Preview and, after in-app approval, export the current scene inside its exports directory.', {
      ...writeBaseSchema,
      format: z.enum(['pdf', 'images', 'gif', 'video', 'fcpxml', 'zip'])
    }, 'export', false)

    server.registerPrompt('draft_scene_storyboard', {
      description: 'Draft structured boards for a scene and propose them to Storyboarder.',
      argsSchema: {
        sceneId: z.string().max(256).optional(),
        boardCount: z.string().max(16).optional(),
        pacing: z.string().max(256).optional()
      }
    }, async ({ sceneId, boardCount, pacing }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Read storyboarder://project/script and storyboarder://scene/current. Draft ${boardCount || 'an appropriate number of'} boards for ${sceneId || 'the current scene'} with ${pacing || 'story-appropriate'} pacing. Use only action, dialogue, notes, durationMs, and newShot, then call storyboarder_propose_board_draft with the latest revision.`
        }
      }]
    }))

    server.registerPrompt('review_scene_continuity', {
      description: 'Review visual, action, character, and camera continuity without editing.',
      argsSchema: { focus: z.string().max(1024).optional() }
    }, async ({ focus }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Review storyboarder://scene/current, board thumbnails, and storyboarder://project/shot-list for continuity${focus ? `, focusing on ${focus}` : ''}. Report findings before proposing any edits.`
        }
      }]
    }))

    server.registerPrompt('review_scene_timing', {
      description: 'Review board and dialogue timing without editing.',
      argsSchema: { targetDuration: z.string().max(64).optional() }
    }, async ({ targetDuration }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Review storyboarder://scene/current for dialogue readability, board durations, and pacing${targetDuration ? ` against a target duration of ${targetDuration}` : ''}. Return recommendations and wait before calling storyboarder_propose_board_updates.`
        }
      }]
    }))

    return server
  }

  async _handleHttpRequest (request, response) {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      sendJsonError(response, 403, 'Loopback clients only')
      return
    }
    if (!hasBearerToken(request, this.token)) {
      sendJsonError(response, 401, 'Unauthorized')
      return
    }
    if (!isAllowedOrigin(request.headers.origin)) {
      sendJsonError(response, 403, 'Invalid Origin')
      return
    }
    const host = String(request.headers.host || '').toLowerCase()
    if (!/^((127\.0\.0\.1|localhost):\d+|\[::1\]:\d+)$/.test(host)) {
      sendJsonError(response, 403, 'Invalid Host')
      return
    }
    if (request.url !== '/mcp') {
      sendJsonError(response, 404, 'Not found')
      return
    }
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
      sendJsonError(response, 405, 'Method not allowed')
      return
    }

    if (request.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) {
      sendJsonError(response, 415, 'Content-Type must be application/json')
      return
    }

    const body = request.method === 'POST' ? await readJsonBody(request) : undefined
    const sessionId = request.headers['mcp-session-id']
    let session = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined

    if (!session && request.method === 'POST' && !sessionId && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: id => {
          this.sessions.set(id, { transport, server })
        }
      })
      const server = this._createMcpServer()
      transport.onclose = () => {
        const id = transport.sessionId
        if (id) this.sessions.delete(id)
      }
      session = { transport, server }
      await server.connect(transport)
    }

    if (!session) {
      sendJsonError(response, 400, 'Invalid or missing MCP session')
      return
    }

    await session.transport.handleRequest(request, response, body)
  }
}

module.exports = {
  ALLOWED_EXPORT_FORMATS,
  ALLOWED_IMAGE_LAYERS,
  ALLOWED_IMAGE_MIME_TYPES,
  HOST,
  MAX_BODY_BYTES,
  McpBridgeError,
  StoryboarderMcpService,
  hasBearerToken,
  isAllowedOrigin,
  isLoopbackAddress
}
