import { randomBytes, randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Hono, type Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { ZodType } from 'zod'
import {
  ACCOUNT_API_PREFIX,
  ACCOUNT_BROWSER_HEADER,
  accountPaths,
  assertionRequestSchema,
  credentialClaimsSchema,
  deviceCodeRequestSchema,
  deviceCodeResponseSchema,
  previewChallengeRequestSchema,
  registerNodeRequestSchema,
  TICKET_LIFETIME_SECONDS,
  ASSERTION_LIFETIME_SECONDS,
  ticketRequestSchema,
  tokenRequestSchema,
  tokenResponseSchema,
  DEVICE_CODE_GRANT,
  type Account,
  type AccountError,
  type ListNodesResponse,
  type PreviewResponse,
  type TokenResponse,
} from '@acorn/protocol/account.ts'
import { generateSigningKey, signToken, verifyToken } from '@acorn/protocol/accountToken.ts'
import { previewDomainHost, previewNodeLabel } from '@acorn/protocol/relay.ts'

// A small account service for the tests and `pnpm dev:agent` flows that need one
// to exist (docs/account-api/testing.md § The stand-in). Like the control plane stub, it isn't a mock: every
// request is parsed by the schema the API publishes, so a client that changes what it sends fails here
// instead of in a green suite. It keeps everything in memory and signs with a key made at startup.
//
// What it leaves out is the hosted service's job: no GitHub, no website, no database, no audit log.
// A device flow is approved at once for one test account unless a test says otherwise. So is the
// browser sign-in the phone app sends a person to.

export type AccountStub = {
  url: string
  /** Where registered Nodes are told their relay is. Set it once a relay is listening. */
  setRelayUrl(url: string): void
  /** Approve a pending device flow as this login, the way a person does in the browser. */
  approve(userCode: string, login: string): void
  /** Run a whole device flow as this login, for a test that needs a second account. */
  signIn(login: string): Promise<TokenResponse>
  /** The requests it has answered, as `METHOD /path`, so a test can show a Node never called it. */
  requests(): string[]
  /** Every account's Nodes, as the website would list them. */
  nodes(): { nodeId: string; accountId: string; label: string; fingerprint: string; channelKey?: string }[]
  /** Make the next listing say this Node has another certificate, so a test can show a client refusing it. */
  setListedFingerprint(nodeId: string, fingerprint: string): void
  /** What clicking Remove on the website does: the Node is forgotten and its credential revoked. */
  remove(nodeId: string): void
  /** A ticket for any account and Node, owned or not, so a test can show the relay refusing it. */
  forgeTicket(accountId: string, nodeId: string): Promise<string>
  /** Where previews are served and which certificate authority to ask. `undefined` is a service with none. */
  setPreview(preview: PreviewResponse | undefined): void
  /** The TXT records Nodes have published, by name, which is what a certificate authority would look up. */
  challenges(): ReadonlyMap<string, string>
  close(): Promise<void>
}

export type AccountStubOptions = {
  /** Who a device flow is approved as the moment it starts. `false` waits for `approve`. */
  approveAs?: string | false
  accessTokenSeconds?: number
  /** Seconds between polls the stub asks for. */
  interval?: number
  /** The port to listen on, so a dev flow keeps one address. By default the system picks. */
  port?: number
  /** The clock, in epoch milliseconds, so a test can run past an expiry. */
  now?: () => number
}

type Flow = { userCode: string; expiresAt: number; login?: string }
type Registered = {
  accountId: string
  label: string
  fingerprint: string
  channelKey?: string
  credentialId: string
}

// The website's session cookie, as the stand-in sets it.
const SESSION_COOKIE = 'acorn_account_session'

export async function startAccountStub(options: AccountStubOptions = {}): Promise<AccountStub> {
  const now = options.now ?? Date.now
  const nowSeconds = (): number => Math.floor(now() / 1000)
  const approveAs = options.approveAs === undefined ? 'test-account' : options.approveAs
  const accessTokenSeconds = options.accessTokenSeconds ?? 3600
  const { signing, keys } = await generateSigningKey('stand-in-1')
  const flows = new Map<string, Flow>()
  const accessTokens = new Map<string, { account: Account; expiresAt: number }>()
  const refreshTokens = new Map<string, Account>()
  const browserSessions = new Map<string, Account>()
  const registered = new Map<string, Registered>()
  const revoked = new Set<string>()
  let relayUrl = 'ws://relay.invalid'
  let baseUrl = ''
  let preview: PreviewResponse | undefined = {
    domain: 'preview.acorn.test',
    acmeDirectory: 'https://acme.invalid/directory',
  }
  const challenges = new Map<string, string>()

  // An account's ID has nothing to do with its login, as the hosted service's doesn't.
  const accounts = new Map<string, Account>()
  const accountFor = (login: string): Account => {
    const known = accounts.get(login)
    if (known) return known
    const account = { id: `acct_${randomBytes(6).toString('hex')}`, name: login }
    accounts.set(login, account)
    return account
  }

  const issueTokens = (account: Account): TokenResponse => {
    const accessToken = `at_${randomBytes(24).toString('base64url')}`
    const refreshToken = `rt_${randomBytes(24).toString('base64url')}`
    accessTokens.set(accessToken, { account, expiresAt: now() + accessTokenSeconds * 1000 })
    refreshTokens.set(refreshToken, account)
    return { accessToken, refreshToken, expiresIn: accessTokenSeconds, account }
  }

  const approve = (userCode: string, login: string): void => {
    const flow = [...flows.values()].find((candidate) => candidate.userCode === userCode)
    if (!flow) throw new Error(`No pending device flow has the code ${userCode}.`)
    flow.login = login
  }

  const fail = (c: Context, status: 400 | 401 | 404 | 409, error: AccountError['error'], message?: string) =>
    c.json({ error, ...(message ? { message } : {}) } satisfies AccountError, status)

  // The request body, parsed by the published schema, or the answer to send back instead.
  const parse = async <T>(c: Context, schema: ZodType<T>): Promise<{ data: T } | { refusal: Response }> => {
    const result = schema.safeParse(await c.req.json().catch(() => null))
    return result.success
      ? { data: result.data }
      : { refusal: fail(c, 400, 'invalid_request', result.error.issues[0]?.message) }
  }

  // A bearer token, or the website's cookie from a page that also sent the header only a page of the
  // service's own can (docs/account-api.md § Browsers).
  const signedIn = (c: Context): Account | null => {
    const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''
    const entry = accessTokens.get(token)
    if (entry) return entry.expiresAt > now() ? entry.account : null
    if (c.req.header(ACCOUNT_BROWSER_HEADER) !== '1') return null
    return browserSessions.get(getCookie(c, SESSION_COOKIE) ?? '') ?? null
  }

  const startBrowserSession = (c: Context, login: string): void => {
    const id = randomBytes(24).toString('base64url')
    browserSessions.set(id, accountFor(login))
    setCookie(c, SESSION_COOKIE, id, { httpOnly: true, sameSite: 'Lax', path: '/' })
  }

  const claims = (accountId: string) => ({ iss: baseUrl, sub: accountId, jti: randomUUID(), iat: nowSeconds() })

  const ticketFor = (accountId: string, nodeId: string): Promise<string> =>
    signToken(
      'ticket',
      {
        ...claims(accountId),
        aud: 'relay',
        node: nodeId,
        exp: nowSeconds() + TICKET_LIFETIME_SECONDS,
      },
      signing,
    )

  const requests: string[] = []
  const app = new Hono()
  app.use('*', (c, next) => (requests.push(`${c.req.method} ${c.req.path}`), next()))
  app.get(accountPaths.keys, (c) => c.json(keys))
  app.get(accountPaths.revoked, (c) => c.json({ credentials: [...revoked] }))

  app.post(accountPaths.deviceCode, async (c) => {
    const body = await parse(c, deviceCodeRequestSchema)
    if ('refusal' in body) return body.refusal
    const deviceCode = randomBytes(24).toString('base64url')
    const userCode = `${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`.toUpperCase()
    flows.set(deviceCode, { userCode, expiresAt: now() + 900_000, ...(approveAs ? { login: approveAs } : {}) })
    return c.json({
      deviceCode,
      userCode,
      verificationUri: `${baseUrl}/device`,
      expiresIn: 900,
      interval: options.interval ?? 1,
    })
  })

  app.post(accountPaths.token, async (c) => {
    const body = await parse(c, tokenRequestSchema)
    if ('refusal' in body) return body.refusal
    if (body.data.grantType === 'refresh_token') {
      const account = refreshTokens.get(body.data.refreshToken)
      if (!account) return fail(c, 400, 'invalid_grant')
      refreshTokens.delete(body.data.refreshToken)
      return c.json(issueTokens(account))
    }
    const flow = flows.get(body.data.deviceCode)
    if (!flow) return fail(c, 400, 'invalid_grant')
    if (flow.expiresAt <= now()) return fail(c, 400, 'expired_token')
    if (!flow.login) return fail(c, 400, 'authorization_pending')
    flows.delete(body.data.deviceCode)
    return c.json(issueTokens(accountFor(flow.login)))
  })

  app.get(accountPaths.account, (c) => {
    const account = signedIn(c)
    return account ? c.json(account) : fail(c, 401, 'invalid_token')
  })

  app.put(`${ACCOUNT_API_PREFIX}/nodes/:nodeId`, async (c) => {
    const account = signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    const nodeId = c.req.param('nodeId')
    const body = await parse(c, registerNodeRequestSchema)
    if ('refusal' in body) return body.refusal
    if (!ticketRequestSchema.safeParse({ nodeId }).success) return fail(c, 400, 'invalid_request', 'Not a Node ID.')
    const existing = registered.get(nodeId)
    if (existing && existing.accountId !== account.id)
      return fail(c, 409, 'conflict', 'Another account owns that Node.')
    if (existing) revoked.add(existing.credentialId)
    const credential = { ...claims(account.id), aud: 'relay', node: nodeId }
    registered.set(nodeId, { accountId: account.id, ...body.data, credentialId: credential.jti })
    return c.json({ relay: { url: relayUrl, credential: await signToken('credential', credential, signing) }, keys })
  })

  app.get(accountPaths.nodes, (c) => {
    const account = signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    const nodes = [...registered]
      .filter(([, node]) => node.accountId === account.id)
      .map(([nodeId, { label, fingerprint, channelKey }]) => ({
        nodeId,
        label,
        fingerprint,
        ...(channelKey ? { channelKey } : {}),
        relayUrl,
      }))
    return c.json({ nodes } satisfies ListNodesResponse)
  })

  app.delete(`${ACCOUNT_API_PREFIX}/nodes/:nodeId`, (c) => {
    const account = signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    const node = registered.get(c.req.param('nodeId'))
    if (node?.accountId !== account.id) return fail(c, 404, 'not_found')
    remove(c.req.param('nodeId'))
    return c.body(null, 204)
  })

  // A ticket and an assertion are for a Node the account owns, and the answer for any other is the
  // same as for one that doesn't exist.
  const ownedNode = async (c: Context, schema: ZodType<{ nodeId: string }>) => {
    const account = signedIn(c)
    if (!account) return { refusal: fail(c, 401, 'invalid_token') }
    const body = await parse(c, schema)
    if ('refusal' in body) return body
    if (registered.get(body.data.nodeId)?.accountId !== account.id) return { refusal: fail(c, 404, 'not_found') }
    return { account, nodeId: body.data.nodeId }
  }

  app.post(accountPaths.tickets, async (c) => {
    const owned = await ownedNode(c, ticketRequestSchema)
    if ('refusal' in owned) return owned.refusal
    const ticket = await ticketFor(owned.account.id, owned.nodeId)
    return c.json({ ticket, expiresAt: nowSeconds() + TICKET_LIFETIME_SECONDS, relayUrl })
  })

  app.post(accountPaths.assertions, async (c) => {
    const owned = await ownedNode(c, assertionRequestSchema)
    if ('refusal' in owned) return owned.refusal
    const expiresAt = nowSeconds() + ASSERTION_LIFETIME_SECONDS
    const assertion = await signToken(
      'assertion',
      { ...claims(owned.account.id), aud: owned.nodeId, exp: expiresAt },
      signing,
    )
    return c.json({ assertion, expiresAt })
  })

  app.get(accountPaths.preview, (c) => (preview ? c.json(preview) : fail(c, 404, 'not_found')))

  // The only route a Node's own credential opens. The record's name comes from the credential's Node, so a
  // Node can't publish under another's label.
  app.put(accountPaths.previewChallenge, async (c) => {
    const credential = await verifyToken(
      c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
      'credential',
      credentialClaimsSchema,
      keys,
      nowSeconds(),
    )
    if (!credential || revoked.has(credential.jti)) return fail(c, 401, 'invalid_token')
    if (!preview) return fail(c, 404, 'not_found')
    const body = await parse(c, previewChallengeRequestSchema)
    if ('refusal' in body) return body.refusal
    challenges.set(
      `_acme-challenge.${await previewNodeLabel(credential.node)}.${previewDomainHost(preview.domain)}`,
      body.data.value,
    )
    return c.body(null, 204)
  })

  // Where the phone app sends a person to sign in. The stand-in signs in the one test account at once and
  // sends the browser back to a path on its own origin.
  app.get(accountPaths.browserSignIn, (c) => {
    const next = c.req.query('next') ?? '/'
    if (!next.startsWith('/') || next.startsWith('//')) return fail(c, 400, 'invalid_request', 'next is a path.')
    startBrowserSession(c, approveAs || 'test-account')
    return c.redirect(next)
  })
  // The browser page a person would approve on. The stub approves without one, so this only explains.
  app.get('/device', (c) => c.text('This is the stand-in account service. It approves sign-ins without asking.'))
  // Not part of the API: the hook the contract tests use to approve, the same on every implementation.
  app.post('/_test/approve', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { userCode?: string; login?: string } | null
    if (!body?.userCode || !body.login) return fail(c, 400, 'invalid_request')
    try {
      approve(body.userCode, body.login)
    } catch {
      return fail(c, 404, 'not_found')
    }
    return c.body(null, 204)
  })

  // Not part of the API either: signs a browser in as this login, so the contract tests can reach the routes
  // a cookie opens without a GitHub page.
  app.post('/_test/session', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { login?: string } | null
    if (!body?.login) return fail(c, 400, 'invalid_request')
    startBrowserSession(c, body.login)
    return c.body(null, 204)
  })

  function remove(nodeId: string): void {
    const node = registered.get(nodeId)
    if (!node) return
    revoked.add(node.credentialId)
    registered.delete(nodeId)
  }

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const listening = serve({ fetch: app.fetch, port: options.port ?? 0, hostname: '127.0.0.1' }, () =>
      resolve(listening),
    )
  })
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url: baseUrl,
    setRelayUrl: (url) => (relayUrl = url),
    approve,
    requests: () => [...requests],
    async signIn(login) {
      const post = async (path: string, body: unknown): Promise<unknown> =>
        (await fetch(`${baseUrl}${path}`, { method: 'POST', body: JSON.stringify(body) })).json()
      const code = deviceCodeResponseSchema.parse(await post(accountPaths.deviceCode, {}))
      approve(code.userCode, login)
      return tokenResponseSchema.parse(
        await post(accountPaths.token, { grantType: DEVICE_CODE_GRANT, deviceCode: code.deviceCode }),
      )
    },
    nodes: () =>
      [...registered].map(([nodeId, { accountId, label, fingerprint, channelKey }]) => ({
        nodeId,
        accountId,
        label,
        fingerprint,
        ...(channelKey ? { channelKey } : {}),
      })),
    setListedFingerprint(nodeId, fingerprint) {
      const node = registered.get(nodeId)
      if (node) node.fingerprint = fingerprint
    },
    remove,
    forgeTicket: ticketFor,
    setPreview: (next) => (preview = next),
    challenges: () => challenges,
    close: () =>
      new Promise<void>((resolve) => {
        ;(server as unknown as Server).closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
