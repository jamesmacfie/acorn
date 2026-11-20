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
import { linkFromDelivery, settingsRoutes } from './settings'
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

async function state(links: () => Promise<SlackLink[]>): Promise<SlackState> {
  const gateway = { links } as SlackGateway
  const service = {
    fetch: async () =>
      Response.json({
        nodes: [{ nodeId: OTHER_NODE, label: 'Mac Studio', fingerprint: 'a'.repeat(64), relayUrl: 'wss://relay.test' }],
      }),
    url: async () => '',
  }
  const routes = settingsRoutes({
    store: slackStore(makeTestNodeContext({ plugin: { name: 'slack' } }).storage.open()),
    gateway,
    service,
    onLinksChanged: async () => {},
    approvalsOnLink: { value: false },
  })
  const response = await new Hono<AppEnv>()
    .use('/api/*', ...testGate({ kind: 'device', deviceId: 'd1', userId: 'james' }))
    .route('/api/slack', routes)
    .fetch(new Request('http://acorn.test/api/slack/state'), { DATA_DIR: dataDir, NODE_ID } as unknown as Env)
  return (await response.json()) as SlackState
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
    { teamId: 'T1', teamName: 'Acme', slackUserName: 'James', here: false, nodeLabel: 'Mac Studio', approvals: false },
  ])
  expect((await state(async () => [link(NODE_ID)])).links).toEqual([
    { teamId: 'T1', teamName: 'Acme', slackUserName: 'James', here: true, approvals: false },
  ])
})

it("passes on the gateway's failure as an error, still signed in", async () => {
  const failed = await state(async () => {
    throw new Error('The Slack gateway didn’t answer.')
  })
  expect(failed).toMatchObject({ signedIn: true, links: [], error: 'The Slack gateway didn’t answer.' })
})

it('records the link a sender-routed delivery proves, with the approvals choice, and nothing else', async () => {
  const store = slackStore(makeTestNodeContext({ plugin: { name: 'slack' } }).storage.open())
  const deps = {
    store,
    gateway: { links: async () => [link(NODE_ID)] } as SlackGateway,
    approvalsOnLink: { value: true },
  }
  const delivery = (routedBy: 'sender' | 'grant', team_id: string) => ({
    eventId: 'Ev1',
    routedBy,
    kind: 'event' as const,
    payload: { team_id, event: { type: 'app_mention' } },
  })
  expect(await linkFromDelivery(deps, delivery('grant', 'T1'))).toBe(false)
  expect(await linkFromDelivery(deps, delivery('sender', 'T0OTHER'))).toBe(false)
  expect(await store.hasLinks()).toBe(false)
  expect(await linkFromDelivery(deps, delivery('sender', 'T1'))).toBe(true)
  expect(await store.link('T1')).toMatchObject({ slackUserId: 'U0JAMES', approvals: true })
})
