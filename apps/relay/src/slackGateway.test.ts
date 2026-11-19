import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startAccountStub, type AccountStub } from '@acorn/node-core/testkit'
import { accountAuth } from './auth'
import { nodeHarness, waitFor, type RunningNode } from './testkit/nodes'
import { startRelay, type Relay } from './relay'

// The Slack gateway end to end (docs/account-api/slack-gateway.md): the stand-in gateway and its fake
// Slack, a relay that checks tickets, and a real Node that signed in, turned on remote access, and linked
// Slack from Settings → Slack. A mention reaches the Node's gateway route through the relay with a real
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

  it('makes no request to the gateway and acts on nothing before a link', async () => {
    node = await startNode()
    await signIn(node)
    expect((await ask(node, 'PUT', '/remote-access', { enabled: true })).status).toBe(200)
    await waitFor(async () => (await ask(node, 'GET', '/state')).json?.remoteAccess.connected === true, 'the relay')
    expect(account.requests().filter((line) => line.includes('/slack/'))).toEqual([])
  }, 180_000)

  it('links from Settings → Slack, and the link reaches the Node', async () => {
    const started = await slack(node, 'POST', '/link', { approvals: false })
    expect(started.status).toBe(200)
    expect((await fetch(`${started.json!.url}?team=${TEAM}&user=U0OWNER&name=owner`)).status).toBe(200)
    const state = await slack(node, 'GET', '/state')
    expect(state.json).toMatchObject({
      signedIn: true,
      remoteAccess: true,
      links: [{ teamId: TEAM, teamName: 'Relay Test', slackUserName: 'owner', here: true, approvals: false }],
    })
  }, 60_000)

  it("delivers the owner's mention to the Node, which reacts and answers through the gateway's grant", async () => {
    const before = account.slack.calls().length
    const sent = await account.slack.mention({ teamId: TEAM, channel: 'C0GENERAL', user: 'U0OWNER', text: 'hello' })
    expect(sent.status).toBe(200)
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
