import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startAccountStub, type AccountStub } from '@acorn/node-core/testkit'
import { slackGatewayPaths } from '@acorn/protocol/account.ts'
import { accountAuth } from './auth'
import { nodeHarness, waitFor, type RunningNode } from './testkit/nodes'
import { startRelay, type Relay } from './relay'

// The Slack gateway end to end (docs/account-api/slack-gateway.md): the stand-in gateway and its fake
// Slack, a relay that checks tickets, and a real Node that signed in, turned on remote access, and linked
// and confirmed Slack from Settings → Slack. A mention reaches the Node's gateway route through the relay with a real
// gateway token, and the Node's answers come back as Slack calls the gateway checked against its grants.

let account: AccountStub
let relay: Relay
const { startNode, request, ask, signIn, stopAll } = nodeHarness(() => account)
const TEAM = 'T0RELAY'

beforeAll(async () => {
  account = await startAccountStub()
  relay = await startRelay({ auth: await accountAuth({ url: account.url, revocationPollMs: 100 }), log: () => {} })
  account.setRelayUrl(`ws://127.0.0.1:${relay.port}`)
  account.slack.installTeam({ teamId: TEAM, teamName: 'Relay Test' })
}, 30_000)

afterAll(async () => {
  await stopAll()
  await relay.close()
  await account.close()
})

const slack = (node: RunningNode, method: string, path: string, body?: unknown) =>
  request(node, method, `/v1/p/slack${path}`, body)

describe('Slack through the relay', () => {
  let node: RunningNode
  let heldThread: string

  it('makes no request to the gateway and acts on nothing before a link', async () => {
    node = await startNode()
    await signIn(node)
    expect((await ask(node, 'PUT', '/remote-access', { enabled: true })).status).toBe(200)
    await waitFor(async () => (await ask(node, 'GET', '/state')).json?.remoteAccess.connected === true, 'the relay')
    expect(account.requests().filter((line) => line.includes('/slack/'))).toEqual([])
  }, 180_000)

  it('links from Settings → Slack, and the link counts once the device confirms its Slack user', async () => {
    const started = await slack(node, 'POST', '/link', {})
    expect(started.status).toBe(200)
    expect((await fetch(`${started.json!.url}?team=${TEAM}&user=U0OWNER&name=owner`)).status).toBe(200)
    const link = { teamId: TEAM, teamName: 'Relay Test', slackUserName: 'owner', slackUserId: 'U0OWNER', here: true }
    expect((await slack(node, 'GET', '/state')).json).toMatchObject({
      signedIn: true,
      remoteAccess: true,
      links: [{ ...link, confirmed: false, approvals: false }],
    })
    const confirmed = await slack(node, 'POST', '/confirm', { teamId: TEAM, slackUserId: 'U0OWNER', approvals: false })
    expect(confirmed.status).toBe(200)
    expect((await slack(node, 'GET', '/state')).json).toMatchObject({
      links: [{ ...link, confirmed: true, approvals: false }],
    })
  }, 60_000)

  it("delivers the owner's mention to the Node, which reacts and answers through the gateway's grant", async () => {
    const before = account.slack.calls().length
    const sent = await account.slack.mention({ teamId: TEAM, channel: 'C0GENERAL', user: 'U0OWNER', text: 'hello' })
    expect(sent.status).toBe(200)
    heldThread = sent.ts!
    expect(account.slack.grants()).toEqual([
      expect.objectContaining({
        teamId: TEAM,
        channelId: 'C0GENERAL',
        threadTs: sent.ts,
        nodeId: node.handshake.nodeId,
      }),
    ])
    // A Node with no project folder has nothing to start the task in, and says so to the owner alone.
    await waitFor(
      () =>
        account.slack
          .calls()
          .slice(before)
          .some((call) => call.method === 'chat.postEphemeral'),
      'the Node to answer',
    )
    const calls = account.slack.calls().slice(before)
    expect(calls.map((call) => call.method)).toEqual(['reactions.add', 'chat.postEphemeral'])
    expect(calls[0]!.args).toMatchObject({ channel: 'C0GENERAL', timestamp: sent.ts, name: 'eyes' })
    expect(calls[1]!.args).toMatchObject({
      user: 'U0OWNER',
      text: 'This Node has no projects with a folder. Add one in Acorn first.',
    })
  }, 60_000)

  it("keeps the Node's calls to the threads it holds, routes the thread by its grant, and gives it up", async () => {
    const { accessToken } = await account.signIn('test-account')
    const gateway = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${account.url}${path}`, {
        method,
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      return { status: response.status, json: (text ? JSON.parse(text) : undefined) as Record<string, any> }
    }
    const slackCall = (method: string, args: object) =>
      gateway('POST', slackGatewayPaths.calls, { teamId: TEAM, method, args })
    const channel = 'C0GENERAL'

    const posted = await slackCall('chat.postMessage', { channel, thread_ts: heldThread, text: 'working' })
    expect(posted.status).toBe(200)
    expect(account.slack.calls().at(-1)!.args).toMatchObject({ username: 'Acorn · owner' })
    const botTs = posted.json.result.ts as string
    expect((await slackCall('chat.update', { channel, ts: botTs, text: 'done' })).status).toBe(200)
    expect((await slackCall('conversations.replies', { channel, ts: heldThread })).status).toBe(200)
    expect((await slackCall('chat.getPermalink', { channel, message_ts: botTs })).status).toBe(200)
    for (const [method, args] of [
      ['chat.postMessage', { channel, thread_ts: heldThread, text: 'to everyone', reply_broadcast: true }],
      ['chat.update', { channel, ts: heldThread, text: "the owner's own message" }],
      ['conversations.replies', { channel, ts: '9.000001' }],
      ['reactions.add', { channel, timestamp: '9.000001', name: 'eyes' }],
    ] as const)
      expect((await slackCall(method, args)).json.error, method).toBe('not_granted')

    // A mention in a held thread goes to that Node, so a stranger gets no note to connect.
    const before = account.slack.calls().length
    account.slack.addUser(TEAM, { id: 'U0STRANGER', name: 'stranger' })
    await account.slack.mention({ teamId: TEAM, channel, user: 'U0STRANGER', text: 'me too', threadTs: heldThread })
    expect(
      account.slack
        .calls()
        .slice(before)
        .filter((call) => String(call.args.text).includes('/slack/connect')),
    ).toEqual([])

    const grant = slackGatewayPaths.grant(TEAM, channel, heldThread)
    expect((await gateway('DELETE', grant)).status).toBe(204)
    expect((await slackCall('chat.postMessage', { channel, thread_ts: heldThread, text: 'late' })).json.error).toBe(
      'not_granted',
    )
    expect((await gateway('DELETE', grant)).json.error).toBe('not_found')
  }, 60_000)

  it("answers a non-owner's /acorn with a note, and leaves the owner's settings alone", async () => {
    account.slack.addUser(TEAM, { id: 'U0GUEST', name: 'guest' })
    account.slack.link({
      teamId: TEAM,
      slackUserId: 'U0GUEST',
      slackUserName: 'guest',
      nodeId: node.handshake.nodeId,
      accountId: account.accountId('test-account'),
    })
    const before = account.slack.calls().length
    await account.slack.command({ teamId: TEAM, user: 'U0GUEST', channel: 'C0GENERAL', text: 'mode conversation' })
    await waitFor(() => account.slack.calls().length > before, 'the note')
    expect(account.slack.calls().at(-1)).toMatchObject({ method: 'chat.postEphemeral', args: { user: 'U0GUEST' } })
  }, 60_000)

  it('tells the sender their Node is offline when it is', async () => {
    await ask(node, 'PUT', '/remote-access', { enabled: false })
    account.slack.link({
      teamId: TEAM,
      slackUserId: 'U0OWNER',
      slackUserName: 'owner',
      nodeId: node.handshake.nodeId,
      accountId: account.accountId('test-account'),
    })
    const before = account.slack.calls().length
    await account.slack.mention({ teamId: TEAM, channel: 'C0GENERAL', user: 'U0OWNER', text: 'are you there' })
    expect(account.slack.calls().slice(before)).toEqual([
      expect.objectContaining({
        method: 'chat.postEphemeral',
        args: expect.objectContaining({
          text: expect.stringMatching(/^Your Node \(.+\) is offline, so nothing was sent\.$/),
        }),
      }),
    ])
  }, 60_000)
})
