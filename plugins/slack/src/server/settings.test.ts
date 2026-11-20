import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { generateSigningKey } from '@acorn/protocol/accountToken.ts'
import type { SlackLink } from '@acorn/protocol/account.ts'
import { recordNodeRelay, type AppEnv } from '@acorn/plugin-api/node'
import { makeTestNodeContext, testGate, type Env } from '@acorn/plugin-api/testkit'
import { AccountNotSignedInError } from '@acorn/plugin-account/contract/service.ts'
import type { SlackState } from '../shared/state'
import type { SlackGateway } from './gateway'
import { settingsRoutes } from './settings'
import { slackStore } from './store'

// Settings → Slack's states, one at a time, as `GET /state` reports them for the client to draw.

const NODE_ID = '7f3c9c1e-5b2a-4d1e-9f77-2a5c8d0b1e44'
const OTHER_NODE = '0d6f3a52-8f0e-4c55-9a43-6a1fd1b5e7c2'
const link = (nodeId: string): SlackLink => ({
  teamId: 'T1',
  teamName: 'Acme',
  slackUserId: 'U0JAMES',
  slackUserName: 'James',
  nodeId,
})

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'acorn-slack-settings-'))
  writeFileSync(join(dataDir, 'node.json'), JSON.stringify({ baseline: 'acorn-1', nodeId: NODE_ID, createdAt: 1 }))
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

const remoteAccessOn = async () =>
  recordNodeRelay(dataDir, {
    relay: { url: 'ws://relay.test', credential: 'c' },
    owner: { accountId: 'acct_james', keys: (await generateSigningKey('k1')).keys },
  })

const newStore = () => slackStore(makeTestNodeContext({ plugin: { name: 'slack' } }).storage.open())

/** Settings → Slack's routes on a device's request, with the gateway reporting `links`. */
function settings(links: () => Promise<SlackLink[]>, store = newStore()) {
  const service = {
    slackGateway: async () => Response.json({}),
    nodes: async () => [
      { nodeId: OTHER_NODE, label: 'Mac Studio', fingerprint: 'a'.repeat(64), relayUrl: 'wss://relay.test' },
    ],
    url: async () => '',
  }
  const routes = settingsRoutes({
    store,
    gateway: { links, unlink: async () => {} } as unknown as SlackGateway,
    service,
    onLinksChanged: async () => {},
  })
  const app = new Hono<AppEnv>()
    .use('/api/*', ...testGate({ kind: 'device', deviceId: 'd1', userId: 'james' }))
    .route('/api/slack', routes)
  return (path: string, body?: unknown) =>
    app.fetch(
      new Request(`http://acorn.test/api/slack${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      }),
      { DATA_DIR: dataDir, NODE_ID } as unknown as Env,
    )
}

async function state(links: () => Promise<SlackLink[]>, store?: ReturnType<typeof newStore>): Promise<SlackState> {
  return (await (await settings(links, store)('/state')).json()) as SlackState
}

it('reports nobody signed in', async () => {
  expect(
    await state(async () => {
      throw new AccountNotSignedInError()
    }),
  ).toEqual({ signedIn: false, remoteAccess: false, links: [] })
})

it('reports remote access off, then on with no link', async () => {
  expect(await state(async () => [])).toEqual({ signedIn: true, remoteAccess: false, links: [] })
  await remoteAccessOn()
  expect(await state(async () => [])).toEqual({ signedIn: true, remoteAccess: true, links: [] })
})

it("names the other Node a link sends Slack work to, and says when it's this one", async () => {
  await remoteAccessOn()
  expect((await state(async () => [link(OTHER_NODE)])).links).toEqual([
    {
      teamId: 'T1',
      teamName: 'Acme',
      slackUserName: 'James',
      slackUserId: 'U0JAMES',
      here: false,
      nodeLabel: 'Mac Studio',
      confirmed: false,
      approvals: false,
    },
  ])
  expect((await state(async () => [link(NODE_ID)])).links).toEqual([
    {
      teamId: 'T1',
      teamName: 'Acme',
      slackUserName: 'James',
      slackUserId: 'U0JAMES',
      here: true,
      confirmed: false,
      approvals: false,
    },
  ])
})

it("passes on the gateway's failure as an error, still signed in", async () => {
  const failed = await state(async () => {
    throw new Error('The Slack gateway didn’t answer.')
  })
  expect(failed).toMatchObject({ signedIn: true, links: [], error: 'The Slack gateway didn’t answer.' })
})

// The gateway's list is only what to offer: whoever holds the account, or the gateway itself, can put
// any Slack user in it.
it('records nothing for a link only the gateway reports, however often the page reads it', async () => {
  const store = newStore()
  await state(async () => [link(NODE_ID)], store)
  await state(async () => [link(NODE_ID)], store)
  expect(await store.hasLinks()).toBe(false)
})

it('confirms only the Slack user the device was shown, for this Node, with that request’s approvals choice', async () => {
  const store = newStore()
  let reported = [link(OTHER_NODE)]
  const send = settings(async () => reported, store)
  const confirm = (slackUserId: string, approvals: boolean) =>
    send('/confirm', { teamId: 'T1', slackUserId, approvals })
  // The gateway sends this user's Slack work to another Node.
  expect((await confirm('U0JAMES', true)).status).toBe(409)
  reported = [link(NODE_ID)]
  // Someone else's Slack user, which the page never showed.
  expect((await confirm('U0MALLORY', true)).status).toBe(409)
  expect(await store.hasLinks()).toBe(false)
  expect((await confirm('U0JAMES', true)).status).toBe(200)
  expect(await store.link('T1')).toMatchObject({ slackUserId: 'U0JAMES', approvals: true })
  expect((await state(async () => reported, store)).links[0]).toMatchObject({ confirmed: true, approvals: true })
  // Confirming the same user again keeps the link, and the threads made under it.
  const { linkId } = (await store.link('T1'))!
  expect((await confirm('U0JAMES', false)).status).toBe(200)
  expect(await store.link('T1')).toMatchObject({ linkId, approvals: false })
})

it('drops a confirmed link when the gateway names another Slack user, which waits for its own confirmation', async () => {
  const store = newStore()
  let reported = [link(NODE_ID)]
  const send = settings(async () => reported, store)
  await send('/confirm', { teamId: 'T1', slackUserId: 'U0JAMES', approvals: true })
  const first = (await store.link('T1'))!.linkId
  reported = [{ ...link(NODE_ID), slackUserId: 'U0MALLORY', slackUserName: 'Mallory' }]
  expect((await state(async () => reported, store)).links[0]).toMatchObject({
    slackUserId: 'U0MALLORY',
    confirmed: false,
    approvals: false,
  })
  expect(await store.hasLinks()).toBe(false)
  // The earlier link's approvals choice doesn't carry over.
  await send('/confirm', { teamId: 'T1', slackUserId: 'U0MALLORY', approvals: false })
  expect(await store.link('T1')).toMatchObject({ slackUserId: 'U0MALLORY', approvals: false })
  expect((await store.link('T1'))!.linkId).not.toBe(first)
})

it('keeps the local links when the gateway fails to answer', async () => {
  const store = newStore()
  await store.confirmLink(link(NODE_ID), false)
  await state(async () => {
    throw new Error('down')
  }, store)
  expect(await store.hasLinks()).toBe(true)
})
