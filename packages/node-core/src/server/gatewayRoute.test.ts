import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GATEWAY_TOKEN_LIFETIME_SECONDS } from '@acorn/protocol/account.ts'
import { generateSigningKey, signToken, type SigningKey } from '@acorn/protocol/accountToken.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { relayHost } from '@acorn/protocol/relay.ts'
import type { Env } from './bindings'
import { createApp } from './index'
import { registerGatewayRoute, type GatewayPrincipal } from './routes/gatewayRoutes'
import { registerRoute } from './routes/registry'
import { recordNodeRelay } from './storage/nodeRelay'

// The gateway door (docs/authentication/gateway-routes.md): a gateway token, for this Node and its
// owner, for the route's plugin, once, through the relay. Nothing else opens it, and it opens nothing else.

const NODE_ID = randomUUID()
const OWNER = 'acct_owner'
const dir = mkdtempSync(join(tmpdir(), 'acorn-gateway-'))
let signing: SigningKey
let stranger: SigningKey
const seen: { path: string; body: string; principal: GatewayPrincipal }[] = []
const disposers: (() => void)[] = []

const env = (overrides: Partial<Env> = {}): Env =>
  ({
    DATA_DIR: dir,
    NODE_ID,
    DEVICES: { authenticate: async (token: string) => (token === 'device-token' ? { deviceId: 'd1' } : null) },
    ACTIVE_IDENTITY: { get: () => 'owner-1' },
    ...overrides,
  }) as unknown as Env

const token = (
  claims: Partial<Record<string, unknown>> = {},
  key = signing,
  type: 'gateway' | 'assertion' = 'gateway',
) => {
  const now = Math.floor(Date.now() / 1000)
  return signToken(
    type,
    {
      iss: 'https://account.test',
      sub: OWNER,
      aud: NODE_ID,
      jti: randomUUID(),
      iat: now,
      exp: now + GATEWAY_TOKEN_LIFETIME_SECONDS,
      scope: 'slack',
      ...claims,
    },
    key,
  )
}

const deliver = (
  path: string,
  bearer: string | undefined,
  options: { host?: string; env?: Partial<Env>; body?: string } = {},
) =>
  createApp().fetch(
    new Request(`https://${options.host ?? relayHost(NODE_ID)}${path}`, {
      method: 'POST',
      headers: { host: options.host ?? relayHost(NODE_ID), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: options.body ?? '{"hello":true}',
    }),
    env(options.env),
  )

beforeAll(async () => {
  const owner = await generateSigningKey('k1')
  signing = owner.signing
  // The same key ID, another key: a token only the right key's signature passes.
  ;({ signing: stranger } = await generateSigningKey('k1'))
  writeFileSync(join(dir, 'node.json'), JSON.stringify({ baseline: ACORN_BASELINE, nodeId: NODE_ID, createdAt: 1 }))
  recordNodeRelay(dir, {
    relay: { url: 'ws://relay.test', credential: 'c' },
    owner: { accountId: OWNER, keys: owner.keys },
  })
  for (const plugin of ['slack', 'other'])
    disposers.push(
      registerGatewayRoute(plugin, async (request, principal) => {
        seen.push({ path: new URL(request.url).pathname, body: await request.text(), principal })
        return Response.json({ ok: true })
      }).dispose,
    )
  disposers.push(
    registerRoute({ plugin: 'slack', prefix: '', fetch: async () => Response.json({ plugin: true }) }).dispose,
  )
})
afterAll(() => disposers.forEach((dispose) => dispose()))

describe('the gateway route', () => {
  it('takes a valid token through the relay, once, and hands the plugin a relative path and the owner', async () => {
    const valid = await token()
    const first = await deliver('/v1/gateway/slack/events', valid)
    expect(first.status).toBe(200)
    expect(seen.at(-1)).toEqual({
      path: '/events',
      body: '{"hello":true}',
      principal: { kind: 'gateway', plugin: 'slack', accountId: OWNER },
    })
    expect((await deliver('/v1/gateway/slack/events', valid)).status).toBe(401)
  })

  it.each([
    ['another type', () => token({}, signing, 'assertion')],
    ['another Node', () => token({ aud: randomUUID() })],
    ['another owner', () => token({ sub: 'acct_someone' })],
    ['another plugin', () => token({ scope: 'other' })],
    ['an expired one', () => token({ exp: Math.floor(Date.now() / 1000) - 1 })],
    ['a stranger key', () => token({}, stranger)],
  ])('refuses %s', async (_name, make) => {
    const before = seen.length
    expect((await deliver('/v1/gateway/slack/events', await make())).status).toBe(401)
    expect(seen).toHaveLength(before)
  })

  it('refuses a valid token that did not come through the relay', async () => {
    const loopback = { incoming: { socket: { remoteAddress: '127.0.0.1' } } } as Partial<Env>
    expect((await deliver('/v1/gateway/slack/events', await token(), { env: loopback })).status).toBe(401)
    expect((await deliver('/v1/gateway/slack/events', await token(), { host: '127.0.0.1:4317' })).status).toBe(401)
    expect((await deliver('/v1/gateway/slack/events', await token(), { env: { browserChannel: true } })).status).toBe(
      401,
    )
  })

  it('refuses every other credential with 403, and no credential with 401', async () => {
    expect((await deliver('/v1/gateway/slack/events', 'device-token')).status).toBe(403)
    expect((await deliver('/v1/gateway/slack/events', undefined)).status).toBe(401)
  })

  it('opens nothing else: a gateway token on a core or plugin route is no credential', async () => {
    expect((await deliver('/v1/core/tasks', await token())).status).toBe(401)
    expect((await deliver('/v1/p/slack', await token())).status).toBe(401)
    // And a token for one plugin doesn't open another's door.
    expect((await deliver('/v1/gateway/other/events', await token())).status).toBe(401)
  })

  it('answers 404 for a plugin with no gateway route, and on a Node with no owner', async () => {
    expect((await deliver('/v1/gateway/nobody/events', await token())).status).toBe(404)
    const bare = mkdtempSync(join(tmpdir(), 'acorn-gateway-bare-'))
    writeFileSync(join(bare, 'node.json'), JSON.stringify({ baseline: ACORN_BASELINE, nodeId: NODE_ID, createdAt: 1 }))
    expect((await deliver('/v1/gateway/slack/events', await token(), { env: { DATA_DIR: bare } })).status).toBe(404)
  })

  it('refuses a body over 256 KiB', async () => {
    const response = await deliver('/v1/gateway/slack/events', await token(), { body: 'x'.repeat(256 * 1024 + 1) })
    expect(response.status).toBe(413)
  })
})
