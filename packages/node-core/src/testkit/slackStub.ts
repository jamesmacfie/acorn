import { createHmac, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { slackGatewayPaths } from '@acorn/protocol/account.ts'

// A fake Slack for the Slack gateway's tests and dev flows (docs/account-api/slack-gateway.md § The
// stand-in). It keeps workspaces, users, and messages in memory, answers the Web API calls a gateway
// makes with a team's bot token, and sends events, clicks, and slash commands to a gateway the way Slack
// does: signed with the app's signing secret, to the gateway's three request addresses.
//
// It runs in front of any service that answers the contract, not only the stand-in, so the conformance
// suite can drive a service under test through it.

export type FakeSlackTeam = { teamId: string; teamName: string; botUserId: string; botId: string; botToken: string }
type FakeSlackMessage = {
  channel: string
  ts: string
  thread_ts?: string
  user?: string
  bot_id?: string
  username?: string
  text: string
  blocks?: unknown[]
  reactions: string[]
}
/** One Web API call a gateway made, and what this fake answered. */
type FakeSlackCall = { teamId: string; method: string; args: Record<string, unknown>; status: number }
/** What the gateway answered a delivery with, and the message's timestamp when there was one. */
type FakeSlackSend = { status: number; ts?: string }

export type FakeSlack = {
  url: string
  /** Point events, clicks, and commands at a gateway. */
  setGateway(url: string): void
  addTeam(team: { teamId: string; teamName: string }): FakeSlackTeam
  addUser(teamId: string, user: { id: string; name: string }): void
  /** A channel's DM with the bot, for this user. */
  dmChannel(userId: string): string
  /** `text` without the mention, which this adds at the front. */
  mention(input: {
    teamId: string
    channel: string
    user: string
    text: string
    threadTs?: string
  }): Promise<FakeSlackSend>
  reply(input: {
    teamId: string
    channel: string
    user: string
    threadTs: string
    text: string
  }): Promise<FakeSlackSend>
  dm(input: { teamId: string; user: string; text: string; threadTs?: string }): Promise<FakeSlackSend>
  click(input: {
    teamId: string
    user: string
    channel: string
    messageTs: string
    threadTs?: string
    ephemeral?: boolean
    action: Record<string, unknown>
    /** Slack's `state.values`: what the message's other inputs hold, such as a ticked checkbox. */
    state?: Record<string, unknown>
  }): Promise<FakeSlackSend>
  command(input: { teamId: string; user: string; channel: string; text: string }): Promise<FakeSlackSend>
  /** An event as Slack would wrap and sign it, for removal events and anything the helpers above don't build. */
  event(teamId: string, event: Record<string, unknown>): Promise<FakeSlackSend>
  /** Every Web API call made, oldest first. */
  calls(): FakeSlackCall[]
  /** Answer this method's next call with `429` and this `Retry-After`. */
  rateLimitNext(method: string, retryAfterSeconds?: number): void
  messages(channel: string): FakeSlackMessage[]
  close(): Promise<void>
}

const sign = (secret: string, timestamp: string, body: string): string =>
  `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`

// A Web API call's arguments, as JSON or as a form. Slack's read methods take only a form, and a form
// carries an object such as `blocks` as a JSON string.
async function webApiArgs(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
    return ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const form = new URLSearchParams(await request.text())
  return Object.fromEntries(
    [...form].map(([key, value]) => {
      if (!/^[[{]/.test(value)) return [key, value]
      try {
        return [key, JSON.parse(value) as unknown]
      } catch {
        return [key, value]
      }
    }),
  )
}

/** Check a request the way Slack's docs say a receiver must: the signature, and a timestamp within five minutes. */
export function verifySlackSignature(
  secret: string,
  headers: { timestamp: string | undefined; signature: string | undefined },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { timestamp, signature } = headers
  if (!timestamp || !signature || Math.abs(nowSeconds - Number(timestamp)) > 300) return false
  return sign(secret, timestamp, body) === signature
}

export async function startFakeSlack(options: { signingSecret: string; port?: number }): Promise<FakeSlack> {
  const teams = new Map<string, FakeSlackTeam & { users: Map<string, string> }>()
  const messages: FakeSlackMessage[] = []
  const calls: FakeSlackCall[] = []
  const limited = new Map<string, number>()
  let gateway = ''
  let seq = 0
  // Slack's timestamps are seconds and a sequence, unique per channel. One counter keeps them unique everywhere.
  const nextTs = (): string => `${Math.floor(Date.now() / 1000)}.${String(++seq).padStart(6, '0')}`
  const id = (prefix: string): string => `${prefix}${randomBytes(5).toString('hex').toUpperCase()}`

  const teamFor = (token: string | undefined) => [...teams.values()].find((team) => `Bearer ${team.botToken}` === token)
  const find = (channel: unknown, ts: unknown) => messages.find((m) => m.channel === channel && m.ts === ts)

  // The Web API, as much of it as the gateway's calls table uses. Every answer is `{ ok, ... }`, as Slack's is.
  const api = (team: FakeSlackTeam, method: string, args: Record<string, unknown>): Record<string, unknown> => {
    switch (method) {
      case 'chat.postMessage': {
        const message: FakeSlackMessage = {
          channel: String(args.channel),
          ts: nextTs(),
          ...(typeof args.thread_ts === 'string' ? { thread_ts: args.thread_ts } : {}),
          bot_id: team.botId,
          user: team.botUserId,
          ...(typeof args.username === 'string' ? { username: args.username } : {}),
          text: String(args.text ?? ''),
          ...(Array.isArray(args.blocks) ? { blocks: args.blocks } : {}),
          reactions: [],
        }
        messages.push(message)
        return { ok: true, channel: message.channel, ts: message.ts, message }
      }
      case 'chat.update': {
        const message = find(args.channel, args.ts)
        if (!message) return { ok: false, error: 'message_not_found' }
        if (typeof args.text === 'string') message.text = args.text
        if (Array.isArray(args.blocks)) message.blocks = args.blocks
        return { ok: true, channel: message.channel, ts: message.ts }
      }
      case 'chat.delete': {
        const index = messages.findIndex((m) => m.channel === args.channel && m.ts === args.ts)
        if (index < 0) return { ok: false, error: 'message_not_found' }
        messages.splice(index, 1)
        return { ok: true }
      }
      case 'chat.postEphemeral':
        return { ok: true, message_ts: nextTs() }
      case 'reactions.add':
      case 'reactions.remove': {
        const message = find(args.channel, args.timestamp)
        if (!message) return { ok: false, error: 'message_not_found' }
        const name = String(args.name)
        const has = message.reactions.includes(name)
        if (method === 'reactions.add' && has) return { ok: false, error: 'already_reacted' }
        if (method === 'reactions.remove' && !has) return { ok: false, error: 'no_reaction' }
        message.reactions =
          method === 'reactions.add' ? [...message.reactions, name] : message.reactions.filter((r) => r !== name)
        return { ok: true }
      }
      case 'conversations.replies': {
        const thread = messages.filter(
          (m) => m.channel === args.channel && (m.ts === args.ts || m.thread_ts === args.ts),
        )
        return { ok: true, messages: thread, has_more: false }
      }
      case 'chat.getPermalink':
        return {
          ok: true,
          permalink: `https://${team.teamId.toLowerCase()}.slack.test/archives/${args.channel}/p${String(args.message_ts).replace('.', '')}`,
        }
      case 'users.info': {
        const name = teams.get(team.teamId)?.users.get(String(args.user))
        return name
          ? {
              ok: true,
              user: { id: args.user, team_id: team.teamId, name, real_name: name, profile: { display_name: name } },
            }
          : { ok: false, error: 'user_not_found' }
      }
      default:
        return { ok: false, error: 'unknown_method' }
    }
  }

  const app = new Hono()
  app.post('/api/:method', async (c) => {
    const team = teamFor(c.req.header('authorization'))
    const method = c.req.param('method')
    const args = await webApiArgs(c.req.raw)
    if (!team) return c.json({ ok: false, error: 'invalid_auth' })
    const retryAfter = limited.get(method)
    if (retryAfter !== undefined) {
      limited.delete(method)
      calls.push({ teamId: team.teamId, method, args, status: 429 })
      return c.json({ ok: false, error: 'ratelimited' }, 429, { 'retry-after': String(retryAfter) })
    }
    calls.push({ teamId: team.teamId, method, args, status: 200 })
    return c.json(api(team, method, args))
  })
  // What a `response_url` points at. Slack's are on hooks.slack.com; this one is on the fake's own address,
  // which a gateway accepts only in its test mode.
  app.post('/hooks/:teamId/:channel/:ts', async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const { teamId, channel, ts } = c.req.param()
    calls.push({ teamId, method: 'respond', args: { channel, ts, ...body }, status: 200 })
    const message = find(channel, ts)
    if (message && body.delete_original) messages.splice(messages.indexOf(message), 1)
    else if (message && body.replace_original) {
      message.text = String(body.text ?? '')
      message.blocks = Array.isArray(body.blocks) ? body.blocks : []
    }
    return c.text('ok')
  })

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const listening = serve({ fetch: app.fetch, port: options.port ?? 0, hostname: '127.0.0.1' }, () =>
      resolve(listening),
    )
  })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // Slack signs the body exactly as sent, and the gateway checks it against the raw bytes.
  const send = async (path: string, body: string, contentType: string): Promise<number> => {
    if (!gateway) throw new Error('The fake Slack has no gateway to send to. Call setGateway first.')
    const timestamp = String(Math.floor(Date.now() / 1000))
    const response = await fetch(`${gateway}${path}`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': sign(options.signingSecret, timestamp, body),
      },
      body,
    })
    await response.body?.cancel()
    return response.status
  }
  const team = (teamId: string) => {
    const known = teams.get(teamId)
    if (!known) throw new Error(`The fake Slack has no team ${teamId}.`)
    return known
  }
  const event = async (teamId: string, inner: Record<string, unknown>): Promise<FakeSlackSend> => {
    const { botUserId } = team(teamId)
    const status = await send(
      slackGatewayPaths.events,
      JSON.stringify({
        type: 'event_callback',
        team_id: teamId,
        api_app_id: 'A0FAKESLACK',
        event_id: id('Ev'),
        event_time: Math.floor(Date.now() / 1000),
        authorizations: [{ team_id: teamId, user_id: botUserId, is_bot: true }],
        event: inner,
      }),
      'application/json',
    )
    return { status }
  }
  // A person's message: stored, as Slack keeps it, then sent as each event the bot's subscriptions get.
  // A mention in a channel arrives twice, as `app_mention` and as `message`.
  const post = async (
    teamId: string,
    input: { channel: string; user: string; text: string; threadTs?: string },
    channelType: 'channel' | 'im',
    mentions: boolean,
  ): Promise<FakeSlackSend> => {
    const ts = nextTs()
    messages.push({
      channel: input.channel,
      ts,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      user: input.user,
      text: input.text,
      reactions: [],
    })
    const base = {
      user: input.user,
      text: input.text,
      ts,
      channel: input.channel,
      team: teamId,
      event_ts: ts,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    }
    let status = 200
    if (mentions) status = (await event(teamId, { type: 'app_mention', ...base })).status
    const message = await event(teamId, { type: 'message', channel_type: channelType, ...base })
    return { status: mentions ? status : message.status, ts }
  }

  return {
    url,
    setGateway: (next) => (gateway = next.replace(/\/+$/, '')),
    addTeam({ teamId, teamName }) {
      const created = {
        teamId,
        teamName,
        botUserId: id('U'),
        botId: id('B'),
        botToken: `xoxb-${randomBytes(12).toString('hex')}`,
      }
      teams.set(teamId, { ...created, users: new Map() })
      return created
    },
    addUser: (teamId, user) => void team(teamId).users.set(user.id, user.name),
    dmChannel: (userId) => `D${userId.slice(1)}`,
    mention: ({ teamId, threadTs, ...input }) =>
      post(
        teamId,
        { ...input, text: `<@${team(teamId).botUserId}> ${input.text}`, ...(threadTs ? { threadTs } : {}) },
        'channel',
        true,
      ),
    reply: ({ teamId, ...input }) =>
      post(teamId, input, 'channel', input.text.includes(`<@${team(teamId).botUserId}>`)),
    dm: ({ teamId, user, text, threadTs }) =>
      post(teamId, { channel: `D${user.slice(1)}`, user, text, ...(threadTs ? { threadTs } : {}) }, 'im', false),
    async click({ teamId, user, channel, messageTs, threadTs, ephemeral, action, state }) {
      const payload = {
        type: 'block_actions',
        team: { id: teamId, domain: teamId.toLowerCase() },
        user: { id: user, username: team(teamId).users.get(user) ?? user, team_id: teamId },
        api_app_id: 'A0FAKESLACK',
        trigger_id: id('trigger'),
        channel: { id: channel },
        container: {
          type: 'message',
          message_ts: messageTs,
          channel_id: channel,
          is_ephemeral: !!ephemeral,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        },
        ...(ephemeral ? {} : { message: find(channel, messageTs) ?? { ts: messageTs } }),
        response_url: `${url}/hooks/${teamId}/${channel}/${messageTs}`,
        state: { values: state ?? {} },
        actions: [{ action_ts: nextTs(), ...action }],
      }
      const status = await send(
        slackGatewayPaths.interactions,
        new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
        'application/x-www-form-urlencoded',
      )
      return { status }
    },
    async command({ teamId, user, channel, text }) {
      const ts = nextTs()
      const status = await send(
        slackGatewayPaths.commands,
        new URLSearchParams({
          team_id: teamId,
          team_domain: teamId.toLowerCase(),
          channel_id: channel,
          user_id: user,
          user_name: team(teamId).users.get(user) ?? user,
          command: '/acorn',
          text,
          api_app_id: 'A0FAKESLACK',
          trigger_id: id('trigger'),
          response_url: `${url}/hooks/${teamId}/${channel}/${ts}`,
        }).toString(),
        'application/x-www-form-urlencoded',
      )
      return { status }
    },
    event,
    calls: () => [...calls],
    rateLimitNext: (method, retryAfterSeconds = 1) => void limited.set(method, retryAfterSeconds),
    messages: (channel) => messages.filter((m) => m.channel === channel),
    close: () =>
      new Promise<void>((resolve) => {
        ;(server as unknown as Server).closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
