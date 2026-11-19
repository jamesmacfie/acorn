import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { request } from 'node:http'
import type { Duplex } from 'node:stream'
import { connect as tlsConnect } from 'node:tls'
import type { Context, Hono } from 'hono'
import { createWebSocketStream, WebSocket } from 'ws'
import {
  SLACK_GATEWAY_NODE_PATH,
  createSlackLinkRequestSchema,
  slackCallRequestSchema,
  slackGatewayPaths,
  type Account,
  type SlackDelivery,
  type SlackGatewayError,
  type SlackLink,
} from '@acorn/protocol/account.ts'
import { RELAY_TLS_STREAM, relayHost, relayUrls } from '@acorn/protocol/relay.ts'
import { startFakeSlack, verifySlackSignature, type FakeSlack, type FakeSlackTeam } from './slackStub'

// The Slack gateway as the stand-in account service runs it (docs/account-api/slack-gateway.md). It
// answers the gateway's routes, routes Slack's requests by the contract's rules, and delivers to Nodes
// over a real relay with real gateway tokens, so a Node under test can't tell it from the hosted one. Its
// Slack is the fake in ./slackStub.ts.
//
// shortcut: no per-Node share of a team's rate budget, and grants never lapse. A `429` from the fake
// Slack passes through as `rate_limited`. The hosted gateway does both.

export type SlackGatewayStub = FakeSlack & {
  /** Add a workspace to the fake Slack and install the app in it, as Add to Slack does. */
  installTeam(team: { teamId: string; teamName: string }): FakeSlackTeam
  /** Link a Slack user to an account's Node, as Sign in with Slack does, with the user added to the workspace. */
  link(link: Omit<SlackLink, 'teamName'> & { accountId: string }): void
  unlink(teamId: string, slackUserId: string): void
  grants(): { teamId: string; channelId: string; threadTs: string; nodeId: string }[]
}

export type SlackGatewayHost = {
  app: Hono
  baseUrl: () => string
  signedIn: (c: Context) => Account | null
  node: (nodeId: string) => { accountId: string; label: string; fingerprint: string } | undefined
  relayUrl: () => string
  ticket: (accountId: string, nodeId: string) => Promise<string>
  gatewayToken: (accountId: string, nodeId: string, scope: string) => Promise<string>
  nowSeconds: () => number
}

type StoredLink = SlackLink & { accountId: string }
type Grant = { teamId: string; channelId: string; threadTs: string; nodeId: string }
type Payload = Record<string, unknown>

const OFFLINE = new Set([0, 404, 502, 504])
const DEV_TEAM = { teamId: 'T0ACORNDEV', teamName: 'Acorn Dev' }

export async function startSlackGateway(host: SlackGatewayHost): Promise<SlackGatewayStub> {
  const signingSecret = randomBytes(16).toString('hex')
  const fake = await startFakeSlack({ signingSecret })
  const installs = new Map<string, FakeSlackTeam>()
  const links: StoredLink[] = []
  const grants = new Map<string, Grant>()
  const seen = new Map<string, number>()
  const pendingLinks = new Map<string, { accountId: string; nodeId: string; expiresAt: number }>()
  const grantKey = (teamId: string, channelId: string, threadTs: string) => `${teamId}/${channelId}/${threadTs}`
  const linkOf = (teamId: string, slackUserId: unknown) =>
    links.find((link) => link.teamId === teamId && link.slackUserId === slackUserId)

  const fail = (
    c: Context,
    status: 400 | 401 | 403 | 404 | 409 | 429 | 502,
    error: SlackGatewayError['error'],
    extra: Partial<SlackGatewayError> = {},
  ) => c.json({ error, ...extra } satisfies SlackGatewayError, status)

  // The Web API, with the team's bot token, as the hosted gateway calls Slack.
  const slack = async (teamId: string, method: string, args: Payload) => {
    const install = installs.get(teamId)
    if (!install) return { status: 404, json: { ok: false, error: 'not_installed' } as Payload }
    const response = await fetch(`${fake.url}/api/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${install.botToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
    return {
      status: response.status,
      retryAfter: Number(response.headers.get('retry-after') ?? 1),
      json: (await response.json()) as Payload,
    }
  }
  const note = (teamId: string, channel: unknown, user: unknown, text: string) =>
    slack(teamId, 'chat.postEphemeral', { channel, user, text })

  function install(team: { teamId: string; teamName: string }): FakeSlackTeam {
    const installed = installs.get(team.teamId) ?? fake.addTeam(team)
    installs.set(team.teamId, installed)
    return installed
  }
  function link(next: StoredLink): void {
    fake.addUser(next.teamId, { id: next.slackUserId, name: next.slackUserName })
    const others = links.filter(
      (l) => l.teamId === next.teamId && (l.slackUserId === next.slackUserId || l.accountId === next.accountId),
    )
    for (const old of others) links.splice(links.indexOf(old), 1)
    links.push(next)
  }
  function unlink(teamId: string, slackUserId: string): void {
    const old = linkOf(teamId, slackUserId)
    if (!old) return
    links.splice(links.indexOf(old), 1)
    for (const [key, grant] of grants) if (grant.teamId === teamId && grant.nodeId === old.nodeId) grants.delete(key)
  }

  // A delivery to one Node: a ticket for its owner opens a `tls` stream through the relay, TLS runs inside
  // it pinned to the fingerprint the Node registered, and one request carries a fresh gateway token. The
  // answer's status, or 0 when nothing answered. A failed connection is tried once more; a status never is.
  async function deliver(nodeId: string, delivery: SlackDelivery): Promise<number> {
    const node = host.node(nodeId)
    if (!node) return 404
    for (let attempt = 0; ; attempt++) {
      const status = await postToNode(node, nodeId, delivery).catch(() => 0)
      if (status !== 0 || attempt === 1) return status
    }
  }
  async function postToNode(node: { accountId: string; fingerprint: string }, nodeId: string, delivery: SlackDelivery) {
    const ticket = await host.ticket(node.accountId, nodeId)
    const stream = await new Promise<Duplex | number>((resolve, reject) => {
      const ws = new WebSocket(relayUrls.connect(host.relayUrl(), nodeId, RELAY_TLS_STREAM), {
        headers: { authorization: `Bearer ${ticket}` },
        perMessageDeflate: false,
        handshakeTimeout: 15_000,
      })
      ws.once('open', () => resolve(createWebSocketStream(ws)))
      ws.once('unexpected-response', (req, res) => (req.destroy(), resolve(res.statusCode ?? 0)))
      ws.once('error', reject)
    }).catch(() => 0)
    if (typeof stream === 'number') return stream
    // A Node's certificate is its own, so the check is the pin below, made before a byte of the request is sent.
    const socket = tlsConnect({ socket: stream, rejectUnauthorized: false, minVersion: 'TLSv1.3' })
    await once(socket, 'secureConnect')
    if (socket.getPeerCertificate().fingerprint256?.replaceAll(':', '').toLowerCase() !== node.fingerprint) {
      socket.destroy()
      throw new Error('The Node presented a certificate it did not register.')
    }
    const body = JSON.stringify(delivery)
    const token = await host.gatewayToken(node.accountId, nodeId, 'slack')
    return await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          method: 'POST',
          path: SLACK_GATEWAY_NODE_PATH,
          createConnection: () => socket,
          headers: {
            host: relayHost(nodeId),
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
          timeout: 10_000,
        },
        (res) => {
          res.resume()
          res.once('end', () => (socket.destroy(), resolve(res.statusCode ?? 0)))
        },
      )
      req.once('timeout', () => req.destroy(new Error('timeout')))
      req.once('error', reject)
      req.end(body)
    })
  }

  const offlineNote = (teamId: string, nodeId: string, channel: unknown, user: unknown) =>
    note(teamId, channel, user, `Your Node (${host.node(nodeId)?.label ?? 'unknown'}) is offline, so nothing was sent.`)
  const connectNote = (teamId: string, channel: unknown, user: unknown) =>
    note(teamId, channel, user, `Connect Slack to your Acorn account to use @acorn: ${host.baseUrl()}/slack/connect`)

  // The routing rules, in order (docs/account-api/slack-gateway.md § Routing).
  async function routeEvent(teamId: string, eventId: string, callback: Payload): Promise<void> {
    const event = callback.event as Payload
    const bot = installs.get(teamId)
    if (!bot || event.bot_id || event.user === bot.botUserId) return
    if (event.type !== 'app_mention' && event.type !== 'message') return
    const channel = String(event.channel)
    const thread = String(event.thread_ts ?? event.ts)
    const delivery: Omit<SlackDelivery, 'routedBy'> = { eventId, kind: 'event', payload: callback }
    const grant = grants.get(grantKey(teamId, channel, thread))
    if (grant) {
      const status = await deliver(grant.nodeId, { ...delivery, routedBy: 'grant' })
      if (OFFLINE.has(status) && linkOf(teamId, event.user)?.nodeId === grant.nodeId)
        await offlineNote(teamId, grant.nodeId, channel, event.user)
      return
    }
    const startsWork = event.type === 'app_mention' || (event.channel_type === 'im' && !event.thread_ts)
    if (!startsWork || typeof event.user !== 'string') return
    const sender = linkOf(teamId, event.user)
    if (!sender) return void (await connectNote(teamId, channel, event.user))
    const status = await deliver(sender.nodeId, { ...delivery, routedBy: 'sender' })
    if (status >= 200 && status < 300)
      grants.set(grantKey(teamId, channel, thread), {
        teamId,
        channelId: channel,
        threadTs: thread,
        nodeId: sender.nodeId,
      })
    else if (OFFLINE.has(status)) await offlineNote(teamId, sender.nodeId, channel, event.user)
  }

  const { app } = host
  const signed = async (c: Context): Promise<string | null> => {
    const body = await c.req.text()
    const headers = {
      timestamp: c.req.header('x-slack-request-timestamp'),
      signature: c.req.header('x-slack-signature'),
    }
    return verifySlackSignature(signingSecret, headers, body, host.nowSeconds()) ? body : null
  }

  app.post(slackGatewayPaths.events, async (c) => {
    const body = await signed(c)
    if (body === null) return c.text('bad signature', 401)
    const callback = JSON.parse(body) as Payload
    if (callback.type === 'url_verification') return c.json({ challenge: callback.challenge })
    const eventId = String(callback.event_id)
    const teamId = String(callback.team_id)
    for (const [id, until] of seen) if (until <= host.nowSeconds()) seen.delete(id)
    if (seen.has(eventId)) return c.body(null, 200)
    seen.set(eventId, host.nowSeconds() + 3600)
    const event = callback.event as Payload
    if (event.type === 'app_uninstalled' || event.type === 'tokens_revoked') {
      installs.delete(teamId)
      for (const old of links.filter((l) => l.teamId === teamId)) unlink(teamId, old.slackUserId)
      return c.body(null, 200)
    }
    // The hosted gateway answers Slack first and delivers after. The stand-in delivers first, so a test
    // that awaits the send sees the result.
    await routeEvent(teamId, eventId, callback)
    return c.body(null, 200)
  })

  app.post(slackGatewayPaths.interactions, async (c) => {
    const body = await signed(c)
    if (body === null) return c.text('bad signature', 401)
    const payload = JSON.parse(new URLSearchParams(body).get('payload') ?? '{}') as Payload
    const teamId = String((payload.team as Payload | undefined)?.id)
    const user = (payload.user as Payload | undefined)?.id
    const container = (payload.container ?? {}) as Payload
    const thread = container.thread_ts ?? (payload.message as Payload | undefined)?.thread_ts
    const grant = thread ? grants.get(grantKey(teamId, String(container.channel_id), String(thread))) : undefined
    const nodeId = grant?.nodeId ?? linkOf(teamId, user)?.nodeId
    if (!nodeId) {
      if (!grant) await connectNote(teamId, container.channel_id, user)
      return c.body(null, 200)
    }
    const status = await deliver(nodeId, {
      eventId: String(payload.trigger_id),
      routedBy: grant ? 'grant' : 'sender',
      kind: 'interaction',
      payload,
    })
    if (OFFLINE.has(status)) await offlineNote(teamId, nodeId, container.channel_id, user)
    return c.body(null, 200)
  })

  app.post(slackGatewayPaths.commands, async (c) => {
    const body = await signed(c)
    if (body === null) return c.text('bad signature', 401)
    const payload = Object.fromEntries(new URLSearchParams(body)) as Payload
    const teamId = String(payload.team_id)
    const sender = linkOf(teamId, payload.user_id)
    if (!sender) {
      await connectNote(teamId, payload.channel_id, payload.user_id)
      return c.body(null, 200)
    }
    const status = await deliver(sender.nodeId, {
      eventId: String(payload.trigger_id),
      routedBy: 'sender',
      kind: 'command',
      payload,
    })
    if (OFFLINE.has(status)) await offlineNote(teamId, sender.nodeId, payload.channel_id, payload.user_id)
    return c.body(null, 200)
  })

  // --- What a Node calls, with the account's access token ---

  app.post(slackGatewayPaths.links, async (c) => {
    const account = host.signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    const body = createSlackLinkRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 400, 'invalid_request')
    if (host.node(body.data.nodeId)?.accountId !== account.id) return fail(c, 404, 'not_found')
    const code = randomBytes(16).toString('base64url')
    const expiresAt = host.nowSeconds() + 600
    pendingLinks.set(code, { accountId: account.id, nodeId: body.data.nodeId, expiresAt })
    return c.json({ url: `${host.baseUrl()}/slack/link/${code}`, expiresAt })
  })
  app.get(slackGatewayPaths.links, (c) => {
    const account = host.signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    return c.json({ links: links.filter((l) => l.accountId === account.id).map(({ accountId: _account, ...l }) => l) })
  })
  app.delete(`/slack/v1/links/:teamId`, (c) => {
    const account = host.signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    const own = links.find((l) => l.teamId === c.req.param('teamId') && l.accountId === account.id)
    if (!own) return fail(c, 404, 'not_linked')
    unlink(own.teamId, own.slackUserId)
    return c.body(null, 204)
  })
  app.delete(`/slack/v1/grants/:teamId/:channelId/:threadTs`, (c) => {
    const account = host.signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    const { teamId, channelId, threadTs } = c.req.param()
    const own = links.find((l) => l.teamId === teamId && l.accountId === account.id)
    if (!own) return fail(c, 404, 'not_linked')
    const key = grantKey(teamId, channelId, threadTs)
    if (grants.get(key)?.nodeId !== own.nodeId) return fail(c, 404, 'not_found')
    grants.delete(key)
    return c.body(null, 204)
  })

  app.post(slackGatewayPaths.calls, async (c) => {
    const account = host.signedIn(c)
    if (!account) return fail(c, 401, 'invalid_token')
    const body = slackCallRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 400, 'invalid_request', { message: body.error.issues[0]?.message })
    const { teamId, method } = body.data
    const args = { ...body.data.args }
    if (!installs.has(teamId)) return fail(c, 404, 'not_installed')
    const own = links.find((l) => l.teamId === teamId && l.accountId === account.id)
    if (!own) return fail(c, 404, 'not_linked')
    const allowed = await allowedCall(own, method, args)
    if (!allowed) return fail(c, 403, 'not_granted')
    if (method === 'respond') {
      const response = await fetch(String(args.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args.body ?? {}),
      })
      await response.body?.cancel()
      return response.ok
        ? c.json({ ok: true, result: {} })
        : fail(c, 502, 'slack_error', { message: `http_${response.status}` })
    }
    const answer = await slack(teamId, method, args)
    if (answer.status === 429) return fail(c, 429, 'rate_limited', { retryAfter: answer.retryAfter })
    if (answer.json.ok !== true) return fail(c, 502, 'slack_error', { message: String(answer.json.error) })
    return c.json({ ok: true, result: answer.json })
  })

  // The calls table: which Slack calls a Node may make, by the threads it holds. `args` is changed in
  // place where the gateway sets a field itself.
  async function allowedCall(own: StoredLink, method: string, args: Payload): Promise<boolean> {
    const held = (channel: unknown, thread: unknown) =>
      grants.get(grantKey(own.teamId, String(channel), String(thread)))?.nodeId === own.nodeId
    // The thread a message sits in, by asking Slack for it, as the hosted gateway would read its own record.
    const threadOf = async (channel: unknown, ts: unknown): Promise<Payload | undefined> =>
      fake.messages(String(channel)).find((m) => m.ts === ts) as Payload | undefined
    const inHeldThread = async (channel: unknown, ts: unknown) => {
      const message = await threadOf(channel, ts)
      return !!message && held(channel, message.thread_ts ?? message.ts)
    }
    const ownerDm = fake.dmChannel(own.slackUserId)
    switch (method) {
      case 'chat.postMessage':
        if (args.reply_broadcast) return false
        args.username = `Acorn · ${own.slackUserName}`
        return args.channel === ownerDm || (typeof args.thread_ts === 'string' && held(args.channel, args.thread_ts))
      case 'chat.update':
      case 'chat.delete': {
        const message = await threadOf(args.channel, args.ts)
        return (
          !!message &&
          message.user === installs.get(own.teamId)?.botUserId &&
          (await inHeldThread(args.channel, args.ts))
        )
      }
      case 'chat.postEphemeral':
        return (
          args.user === own.slackUserId || (typeof args.thread_ts === 'string' && held(args.channel, args.thread_ts))
        )
      case 'reactions.add':
      case 'reactions.remove':
        return inHeldThread(args.channel, args.timestamp)
      case 'conversations.replies':
        return held(args.channel, args.ts)
      case 'chat.getPermalink':
        return inHeldThread(args.channel, args.message_ts)
      case 'users.info':
        return typeof args.user === 'string'
      case 'respond':
        // Slack's are on hooks.slack.com. The stand-in is a test mode, so it takes its fake Slack's too.
        return (
          typeof args.url === 'string' && [`hooks.slack.com`, new URL(fake.url).host].includes(new URL(args.url).host)
        )
      default:
        return false
    }
  }

  // --- The account website's pages, as far as the stand-in has them ---

  // Sign in with Slack, done at once: as `?team=&user=&name=`, or as a user named after the account in a
  // dev workspace the stand-in installs on first use.
  app.get('/slack/link/:code', (c) => {
    const pending = pendingLinks.get(c.req.param('code'))
    if (!pending || pending.expiresAt <= host.nowSeconds())
      return c.text('This link expired. Start again in Acorn.', 404)
    const team = install(
      c.req.query('team')
        ? { teamId: c.req.query('team')!, teamName: c.req.query('teamName') ?? c.req.query('team')! }
        : DEV_TEAM,
    )
    const name = c.req.query('name') ?? 'owner'
    const slackUserId = c.req.query('user') ?? `U0${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 20)
    const taken = linkOf(team.teamId, slackUserId)
    if (taken && taken.accountId !== pending.accountId)
      return c.text('That Slack user is linked to another Acorn account.', 409)
    pendingLinks.delete(c.req.param('code'))
    link({
      teamId: team.teamId,
      teamName: team.teamName,
      slackUserId,
      slackUserName: name,
      nodeId: pending.nodeId,
      accountId: pending.accountId,
    })
    return c.text(`Linked ${name} in ${team.teamName}. You can close this page.`)
  })
  app.get('/slack/connect', (c) =>
    c.text('This is the stand-in account service. Link Slack from Settings > Slack in Acorn.'),
  )

  // Not part of the API: drive the fake Slack over HTTP, for a dev session with no test runner.
  app.post('/_test/slack/:action', async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as never
    const action = c.req.param('action') as 'mention' | 'reply' | 'dm' | 'click' | 'command'
    if (!['mention', 'reply', 'dm', 'click', 'command'].includes(action)) return c.text('unknown action', 404)
    return c.json(await fake[action](input))
  })
  app.get('/_test/slack/calls', (c) => c.json(fake.calls()))

  return Object.assign(fake, {
    installTeam: install,
    link: (next: Omit<SlackLink, 'teamName'> & { accountId: string }) =>
      link({ ...next, teamName: installs.get(next.teamId)?.teamName ?? next.teamId }),
    unlink,
    grants: () => [...grants.values()],
  })
}
