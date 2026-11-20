import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { generateSigningKey, signToken, type SigningKey } from '@acorn/protocol/accountToken.ts'
import type { AccountKeys } from '@acorn/protocol/account.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import type { Env } from '../bindings'
import type { AppEnv, Principal } from '../middleware/auth'
import { channelPublicKey } from '../transport/channelKey'
import { pairingRoutes } from './pairing'

// Who may raise a pairing ask from another computer (docs/api-reference/transport.md § Pairing by
// approval): the Node's owner account and nobody else.

const NODE_ID = randomUUID()
const OWNER = 'acct_owner'
let owner: { accountId: string; keys: AccountKeys } | undefined
let signing: SigningKey
let keys: AccountKeys

vi.mock('../storage/nodeRelay', () => ({ readNodeRelay: () => ({ ...(owner ? { owner } : {}) }) }))
vi.mock('../notify', () => ({ broadcastPairingRequested: vi.fn() }))
const audited = vi.fn()
vi.mock('../auditRequest', () => ({ auditRequest: (...args: unknown[]) => audited(...args), auditActor: vi.fn() }))

const DATA_DIR = mkdtempSync(join(tmpdir(), 'acorn-pairing-ask-'))
const FINGERPRINT = 'ef'.repeat(32)

beforeAll(async () => {
  ;({ signing, keys } = await generateSigningKey('test-1'))
})
afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }))
beforeEach(() => {
  audited.mockClear()
  owner = { accountId: OWNER, keys }
})

const assertion = (claims: Partial<{ sub: string; aud: string; iat: number; exp: number }> = {}, key = signing) =>
  signToken(
    'assertion',
    {
      iss: 'https://account.test',
      sub: OWNER,
      aud: NODE_ID,
      jti: 'assertion-1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      ...claims,
    },
    key,
  )

// `incoming` is the socket the request came in on. The routes read the peer from it, so a request with
// none reads as another computer.
const env = (peer?: string, extra: Partial<Env> = {}) =>
  ({
    NODE_ID,
    DATA_DIR,
    NODE_FINGERPRINT: FINGERPRINT,
    incoming: peer ? { socket: { remoteAddress: peer } } : undefined,
    ...extra,
  }) as unknown as Env

const ask = (body: unknown, peer?: string) =>
  pairingRoutes().open.request('/pair/requests', { method: 'POST', body: JSON.stringify(body) }, env(peer))

it('lets the owner account raise an ask from another computer, shows it as remote, and audits it', async () => {
  const routes = pairingRoutes()
  const response = await routes.open.request(
    '/pair/requests',
    { method: 'POST', body: JSON.stringify({ deviceName: 'MacBook', assertion: await assertion() }) },
    env(),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ phrase: expect.any(String), secret: expect.any(String) })
  const pending = await routes.core.request('/pair/requests', {}, env())
  // The Node's own certificate words, which the owner compares with the words the asker's probe saw.
  expect(await pending.json()).toMatchObject({
    request: { deviceName: 'MacBook', remote: true, identity: fingerprintPhrase(FINGERPRINT) },
  })
  expect(audited).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      action: 'pairing.request.raised',
      details: { accountId: OWNER, assertionId: 'assertion-1', deviceName: 'MacBook' },
    }),
  )
})

it("shows a phone's ask with the Node's channel key words, the key the phone's channel checked", async () => {
  const routes = pairingRoutes()
  const response = await routes.open.request(
    '/pair/requests',
    { method: 'POST', body: JSON.stringify({ deviceName: 'iPhone', assertion: await assertion() }) },
    env(undefined, { browserChannel: true }),
  )
  expect(response.status).toBe(200)
  const { request } = (await (await routes.core.request('/pair/requests', {}, env())).json()) as {
    request: { identity: string }
  }
  expect(request.identity).toBe(fingerprintPhrase(channelPublicKey(DATA_DIR)))
  expect(request.identity).not.toBe(fingerprintPhrase(FINGERPRINT))
})

// A phone could otherwise raise an ask with the account session, allow it with its own token, and claim a
// full device over an ordinary connection (docs/relay/phone-channel/phone-devices.md § A device a phone
// approved).
it.each([
  ['a phone allows it, and gets a phone’s device', { kind: 'device', userId: 'u', deviceKind: 'phone' }, 'phone'],
  ['a computer allows it, and gets a full device', { kind: 'device', userId: 'u' }, undefined],
] as const)('pairs a remote ask claimed off the channel: %s', async (_name, decider: Principal, kind) => {
  const routes = pairingRoutes()
  const issue = vi.fn(async () => ({ token: 'synthetic-token', device: { id: 'd2' } }))
  const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })
  const raised = await routes.open.request(
    '/pair/requests',
    post({ deviceName: 'Laptop', assertion: await assertion() }),
    env(undefined, { browserChannel: true }),
  )
  const { secret } = (await raised.json()) as { secret: string }
  const core = new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('principal', decider)
      await next()
    })
    .route('/', routes.core)
  const { request } = (await (await core.request('/pair/requests', {}, env())).json()) as { request: { id: string } }
  expect((await core.request(`/pair/requests/${request.id}`, post({ decision: 'allow' }), env())).status).toBe(204)

  const claimed = await routes.open.request(
    '/pair/requests/claim',
    post({ secret }),
    env(undefined, { DEVICES: { issue } } as unknown as Partial<Env>),
  )
  expect(claimed.status).toBe(200)
  expect(issue).toHaveBeenCalledWith('Laptop', kind)
})

it('shows an ask from this computer without identity words', async () => {
  const routes = pairingRoutes()
  await routes.open.request(
    '/pair/requests',
    { method: 'POST', body: JSON.stringify({ deviceName: 'acorn' }) },
    env('127.0.0.1'),
  )
  const { request } = (await (await routes.core.request('/pair/requests', {}, env())).json()) as { request: object }
  expect(request).not.toHaveProperty('identity')
  expect(request).not.toHaveProperty('remote')
})

it('refuses an ask from another computer with no assertion', async () => {
  expect((await ask({ deviceName: 'MacBook' })).status).toBe(403)
  expect(audited).not.toHaveBeenCalled()
})

it.each([
  ['another account', { sub: 'acct_someone_else' }],
  ['another Node', { aud: randomUUID() }],
  ['an assertion that has run out', { exp: Math.floor(Date.now() / 1000) - 1 }],
  // The service signs for two minutes. The Node holds it to that, whatever `exp` says.
  ['an assertion signed for longer than two minutes', { exp: Math.floor(Date.now() / 1000) + 121 }],
  [
    'an assertion dated ahead of the Node’s clock',
    { iat: Math.floor(Date.now() / 1000) + 3600, exp: Math.floor(Date.now() / 1000) + 3720 },
  ],
])('refuses an assertion for %s', async (_name, claims) => {
  const response = await ask({ deviceName: 'MacBook', assertion: await assertion(claims) })
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ error: { code: 'pairing_local_only' } })
})

it('refuses an assertion signed by a key the Node was not given', async () => {
  const other = await generateSigningKey('test-1')
  expect((await ask({ deviceName: 'MacBook', assertion: await assertion({}, other.signing) })).status).toBe(403)
})

it('refuses a ticket in place of an assertion', async () => {
  const ticket = await signToken(
    'ticket',
    { iss: 'x', sub: OWNER, aud: 'relay', node: NODE_ID, jti: 't', iat: 1, exp: Math.floor(Date.now() / 1000) + 60 },
    signing,
  )
  expect((await ask({ deviceName: 'MacBook', assertion: ticket })).status).toBe(403)
})

it('keeps the loopback-only rule on a Node with no owner account', async () => {
  owner = undefined
  expect((await ask({ deviceName: 'MacBook', assertion: await assertion() })).status).toBe(403)
})

it('asks from this computer need no assertion', async () => {
  expect((await ask({ deviceName: 'acorn' }, '127.0.0.1')).status).toBe(200)
})

it('counts only asks that show the owner, so bad assertions cannot use up the ceiling', async () => {
  const routes = pairingRoutes()
  const post = async (assertionValue: string | undefined) =>
    (
      await routes.open.request(
        '/pair/requests',
        { method: 'POST', body: JSON.stringify({ deviceName: 'MacBook', assertion: assertionValue }) },
        env(),
      )
    ).status
  for (let attempt = 0; attempt < 20; attempt += 1) expect(await post('not-an-assertion')).toBe(403)
  expect(await post(await assertion())).toBe(200)
})
