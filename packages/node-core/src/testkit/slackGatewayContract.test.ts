import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountPaths,
  createSlackLinkResponseSchema,
  listSlackLinksResponseSchema,
  slackGatewayErrorSchema,
  slackGatewayPaths,
} from '@acorn/protocol/account.ts'
import { startAccountStub, type AccountStub } from './accountStub'

// The Slack gateway's conformance checks that need no Node (docs/account-api/slack-gateway.md § Test an
// implementation): the routes a Node calls, their errors, Slack's signature, and the routing rules that
// end without a delivery. Deliveries, grants, and the calls table run against a real Node through a real
// relay in apps/relay/src/slackGateway.test.ts.

let stub: AccountStub
let token: string
const nodeId = randomUUID()
const TEAM = 'T0CONTRACT'

beforeAll(async () => {
  stub = await startAccountStub()
  token = (await stub.signIn('james')).accessToken
  await call('PUT', accountPaths.node(nodeId), { label: 'Mac Studio', fingerprint: 'a'.repeat(64) })
  stub.slack.installTeam({ teamId: TEAM, teamName: 'Contract' })
})
afterAll(() => stub.close())

async function call(method: string, path: string, body?: unknown, bearer: string | null = token) {
  const response = await fetch(`${stub.url}${path}`, {
    method,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, json: text ? (JSON.parse(text) as unknown) : undefined }
}
const expectError = (result: { status: number; json: unknown }, status: number, code: string) => {
  expect(result.status).toBe(status)
  expect(slackGatewayErrorSchema.parse(result.json).error).toBe(code)
}

describe('links', () => {
  it('starts a link for an owned Node, which Sign in with Slack completes', async () => {
    const started = await call('POST', slackGatewayPaths.links, { nodeId })
    const { url, expiresAt } = createSlackLinkResponseSchema.parse(started.json)
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000 + 500)
    const page = await fetch(`${url}?team=${TEAM}&user=U0JAMES&name=james`)
    expect(page.status).toBe(200)
    const listed = listSlackLinksResponseSchema.parse((await call('GET', slackGatewayPaths.links)).json)
    expect(listed.links).toEqual([
      { teamId: TEAM, teamName: 'Contract', slackUserId: 'U0JAMES', slackUserName: 'james', nodeId },
    ])
  })

  it("refuses a Node the account doesn't own, a bad body, and no token", async () => {
    expectError(await call('POST', slackGatewayPaths.links, { nodeId: randomUUID() }), 404, 'not_found')
    expectError(await call('POST', slackGatewayPaths.links, { nodeId, extra: 1 }), 400, 'invalid_request')
    expectError(await call('GET', slackGatewayPaths.links, undefined, null), 401, 'invalid_token')
  })

  it('refuses a Slack user already linked to another account with 409', async () => {
    const other = await stub.signIn('alice')
    const aliceNode = randomUUID()
    await call('PUT', accountPaths.node(aliceNode), { label: 'Laptop', fingerprint: 'b'.repeat(64) }, other.accessToken)
    const { url } = createSlackLinkResponseSchema.parse(
      (await call('POST', slackGatewayPaths.links, { nodeId: aliceNode }, other.accessToken)).json,
    )
    expect((await fetch(`${url}?team=${TEAM}&user=U0JAMES&name=james`)).status).toBe(409)
  })
})

describe('calls', () => {
  it('names the reason a call is refused', async () => {
    const post = (teamId: string, method: string, args: object) =>
      call('POST', slackGatewayPaths.calls, { teamId, method, args })
    expectError(await post('T0NOWHERE', 'users.info', { user: 'U0JAMES' }), 404, 'not_installed')
    stub.slack.installTeam({ teamId: 'T0OTHER', teamName: 'Other' })
    expectError(await post('T0OTHER', 'users.info', { user: 'U0JAMES' }), 404, 'not_linked')
    expectError(
      await post(TEAM, 'chat.postMessage', { channel: 'C1', thread_ts: '1.000001', text: 'hi' }),
      403,
      'not_granted',
    )
    expectError(await post(TEAM, 'admin.users.remove', {}), 400, 'invalid_request')
    expectError(await post(TEAM, 'respond', { url: 'https://evil.test/hook', body: {} }), 403, 'not_granted')
  })

  it("posts to the owner's DM with the bot, under the owner's name", async () => {
    const result = await call('POST', slackGatewayPaths.calls, {
      teamId: TEAM,
      method: 'chat.postMessage',
      args: { channel: stub.slack.dmChannel('U0JAMES'), text: 'hello' },
    })
    expect(result.status).toBe(200)
    expect(stub.slack.calls().at(-1)).toMatchObject({ method: 'chat.postMessage', args: { username: 'Acorn · james' } })
  })

  it('the fake Slack reads a Web API call sent as a form, as a gateway may send one', async () => {
    const { botToken } = stub.slack.installTeam({ teamId: 'T0FORM', teamName: 'Form' })
    await fetch(`${stub.slack.url}/api/chat.postMessage`, {
      method: 'POST',
      headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ channel: 'C1', text: 'hi', blocks: JSON.stringify([{ type: 'divider' }]) }),
    })
    expect(stub.slack.calls().at(-1)).toMatchObject({
      method: 'chat.postMessage',
      args: { channel: 'C1', text: 'hi', blocks: [{ type: 'divider' }] },
    })
  })

  it("passes Slack's errors and rate limits on in the gateway's terms", async () => {
    const info = (user: string) =>
      call('POST', slackGatewayPaths.calls, { teamId: TEAM, method: 'users.info', args: { user } })
    expectError(await info('U0NOBODY'), 502, 'slack_error')
    stub.slack.rateLimitNext('users.info', 7)
    const limited = await info('U0JAMES')
    expectError(limited, 429, 'rate_limited')
    expect(slackGatewayErrorSchema.parse(limited.json).retryAfter).toBe(7)
  })
})

describe('what Slack sends', () => {
  it("refuses a request Slack didn't sign", async () => {
    const response = await fetch(`${stub.url}${slackGatewayPaths.events}`, {
      method: 'POST',
      headers: { 'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)), 'x-slack-signature': 'v0=00' },
      body: '{}',
    })
    expect(response.status).toBe(401)
  })

  it('tells an unlinked sender how to connect, and nothing reaches a Node', async () => {
    stub.slack.addUser(TEAM, { id: 'U0STRANGER', name: 'stranger' })
    const before = stub.slack.calls().length
    expect(
      (await stub.slack.mention({ teamId: TEAM, channel: 'C0GENERAL', user: 'U0STRANGER', text: 'help' })).status,
    ).toBe(200)
    const notes = stub.slack.calls().slice(before)
    expect(notes).toEqual([
      expect.objectContaining({ method: 'chat.postEphemeral', args: expect.objectContaining({ user: 'U0STRANGER' }) }),
    ])
    expect(String(notes[0]!.args.text)).toContain('/slack/connect')
    expect(stub.slack.grants()).toEqual([])
  })

  it('tells a linked owner their Node is offline when it is, and records no grant', async () => {
    const before = stub.slack.calls().length
    await stub.slack.mention({ teamId: TEAM, channel: 'C0GENERAL', user: 'U0JAMES', text: 'fix the tests' })
    expect(stub.slack.calls().slice(before)).toEqual([
      expect.objectContaining({
        method: 'chat.postEphemeral',
        args: expect.objectContaining({
          user: 'U0JAMES',
          text: 'Your Node (Mac Studio) is offline, so nothing was sent.',
        }),
      }),
    ])
    expect(stub.slack.grants()).toEqual([])
  })

  it("drops a top-level message without a mention, and the bot's own messages", async () => {
    const before = stub.slack.calls().length
    await stub.slack.reply({
      teamId: TEAM,
      channel: 'C0GENERAL',
      user: 'U0JAMES',
      threadTs: '1.000001',
      text: 'no mention',
    })
    await stub.slack.event(TEAM, { type: 'message', bot_id: 'B1', text: 'a bot', channel: 'C0GENERAL', ts: '2.000001' })
    expect(stub.slack.calls().slice(before)).toEqual([])
  })

  it("keeps the install when a person revokes their own sign-in, and removes it when the bot's token goes", async () => {
    stub.slack.installTeam({ teamId: 'T0REVOKE', teamName: 'Revoke' })
    const info = () =>
      call('POST', slackGatewayPaths.calls, { teamId: 'T0REVOKE', method: 'users.info', args: { user: 'U0JAMES' } })
    await stub.slack.event('T0REVOKE', { type: 'tokens_revoked', tokens: { oauth: ['U0JAMES'] } })
    expectError(await info(), 404, 'not_linked')
    await stub.slack.event('T0REVOKE', { type: 'tokens_revoked', tokens: { bot: ['U0BOT'] } })
    expectError(await info(), 404, 'not_installed')
  })

  it('removes the install, its links, and its grants when the app is uninstalled', async () => {
    stub.slack.installTeam({ teamId: 'T0GONE', teamName: 'Gone' })
    stub.slack.link({
      teamId: 'T0GONE',
      slackUserId: 'U0JAMES',
      slackUserName: 'james',
      nodeId,
      accountId: stub.accountId('james'),
    })
    await stub.slack.event('T0GONE', { type: 'app_uninstalled' })
    const listed = listSlackLinksResponseSchema.parse((await call('GET', slackGatewayPaths.links)).json)
    expect(listed.links.map((link) => link.teamId)).toEqual([TEAM])
    expectError(
      await call('POST', slackGatewayPaths.calls, {
        teamId: 'T0GONE',
        method: 'users.info',
        args: { user: 'U0JAMES' },
      }),
      404,
      'not_installed',
    )
  })

  it('unlinks, and the account has no link in the team after', async () => {
    expect((await call('DELETE', slackGatewayPaths.link(TEAM))).status).toBe(204)
    expectError(await call('DELETE', slackGatewayPaths.link(TEAM)), 404, 'not_linked')
  })
})
