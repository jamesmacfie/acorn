// A remote MCP server behind an OAuth sign-in, on a loopback port, for the sign-in tests. It speaks
// enough of each part: resource and authorization server metadata, dynamic registration, an
// authorization page that approves at once, PKCE, rotating refresh tokens, and revocation.
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export type FakeOauthMcp = {
  url: string
  /** Every access and refresh token issued, to check that none leaks. */
  issued: string[]
  revoked: string[]
  refreshes(): number
  /** Makes every access token issued so far unusable, the way their expiry would. */
  expireAccessTokens(): void
  /** Refuses every refresh while on, the way a revoked grant would. */
  refuseRefresh(on: boolean): void
  /** Follows the sign-in page the way an approving browser would. Answers the address it lands on. */
  approve(authorizationUrl: string): Promise<string>
  close(): Promise<void>
}

const read = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const json = (response: ServerResponse, status: number, value: unknown) =>
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))

export async function startFakeOauthMcp(): Promise<FakeOauthMcp> {
  const clients = new Map<string, string[]>()
  const codes = new Map<string, { challenge: string; clientId: string; redirectUri: string }>()
  const access = new Set<string>()
  const refresh = new Set<string>()
  const issued: string[] = []
  const revoked: string[] = []
  let refreshes = 0
  let refusing = false
  let origin = ''
  const token = () => randomBytes(16).toString('hex')
  const issue = () => {
    const tokens = { access_token: token(), refresh_token: token(), token_type: 'Bearer', expires_in: 3600 }
    access.add(tokens.access_token)
    refresh.add(tokens.refresh_token)
    issued.push(tokens.access_token, tokens.refresh_token)
    return tokens
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', origin)
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
        return json(response, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] })
      if (url.pathname === '/.well-known/oauth-authorization-server')
        return json(response, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          revocation_endpoint: `${origin}/revoke`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
      // An open redirect, for the check that every hop of a sign-in request is held to https.
      if (url.pathname === '/redirect')
        return void response.writeHead(302, { location: url.searchParams.get('to') ?? '/' }).end()
      if (url.pathname === '/register' && request.method === 'POST') {
        const metadata = JSON.parse(await read(request)) as { redirect_uris: string[] }
        const clientId = token()
        clients.set(clientId, metadata.redirect_uris)
        return json(response, 201, { ...metadata, client_id: clientId })
      }
      if (url.pathname === '/authorize') {
        const query = url.searchParams
        const clientId = query.get('client_id') ?? ''
        const redirectUri = query.get('redirect_uri') ?? ''
        if (!clients.get(clientId)?.includes(redirectUri)) return json(response, 400, { error: 'invalid_request' })
        const code = token()
        codes.set(code, { challenge: query.get('code_challenge') ?? '', clientId, redirectUri })
        const back = new URL(redirectUri)
        back.searchParams.set('code', code)
        back.searchParams.set('state', query.get('state') ?? '')
        return void response.writeHead(302, { location: back.href }).end()
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await read(request))
        if (form.get('grant_type') === 'authorization_code') {
          const grant = codes.get(form.get('code') ?? '')
          codes.delete(form.get('code') ?? '')
          const challenge = createHash('sha256')
            .update(form.get('code_verifier') ?? '')
            .digest('base64url')
          if (
            !grant ||
            grant.challenge !== challenge ||
            grant.redirectUri !== form.get('redirect_uri') ||
            grant.clientId !== form.get('client_id')
          )
            return json(response, 400, { error: 'invalid_grant' })
          return json(response, 200, issue())
        }
        if (form.get('grant_type') === 'refresh_token') {
          refreshes++
          // Rotation: a refresh token works once.
          if (refusing || !refresh.delete(form.get('refresh_token') ?? ''))
            return json(response, 400, { error: 'invalid_grant' })
          return json(response, 200, issue())
        }
        return json(response, 400, { error: 'unsupported_grant_type' })
      }
      if (url.pathname === '/revoke' && request.method === 'POST') {
        const revokedToken = new URLSearchParams(await read(request)).get('token') ?? ''
        revoked.push(revokedToken)
        refresh.delete(revokedToken)
        return void response.writeHead(200).end()
      }
      if (url.pathname === '/mcp') {
        const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
        if (!access.has(bearer))
          return void response
            .writeHead(401, {
              'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
            })
            .end()
        const mcp = new McpServer({ name: 'fake-signed-in', version: '1.0.0' })
        mcp.registerTool('echo', { description: 'Answers ok.' }, async () => ({
          content: [{ type: 'text', text: 'ok' }],
        }))
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        response.on('close', () => {
          void transport.close()
          void mcp.close()
        })
        await mcp.connect(transport)
        return transport.handleRequest(request, response)
      }
      response.writeHead(404).end()
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500).end()
    })
  })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fake server did not bind.')
  origin = `http://127.0.0.1:${address.port}`

  return {
    url: `${origin}/mcp`,
    issued,
    revoked,
    refreshes: () => refreshes,
    expireAccessTokens: () => access.clear(),
    refuseRefresh: (on) => {
      refusing = on
    },
    approve: async (authorizationUrl) => {
      const response = await fetch(authorizationUrl, { redirect: 'manual' })
      const location = response.headers.get('location')
      if (response.status !== 302 || !location) throw new Error(`The fake refused the sign-in: ${response.status}`)
      return location
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}
