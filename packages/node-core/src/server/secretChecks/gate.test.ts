import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SECRET_PUBLICATION_PREF_KEY, type SecretCheckReport, type SecretPublicationState } from '@acorn/protocol/secretChecks.ts'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { memoryIdentityStore } from '../activeIdentity'
import { readAudit } from '../audit'
import type { Env } from '../bindings'
import { createIdentityService } from '../core/identity'
import { createPrefService } from '../core/prefs'
import type { AppEnv, Principal } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import { requestIdMiddleware } from '../respond'
import { allowSecretPublicationOnce, readSecretPublication, writeSecretPublication } from '../routes/security/secretPublication'
import { secretReport } from './detector'
import { createSecretPublicationGate, resetSecretPublicationDecisions, SECRET_DECISION_TTL_MS } from './gate'

const DEVICE: Principal = { kind: 'device', userId: 'u1', deviceId: 'd1' }
const AGENT: Principal = { kind: 'internal', userId: 'u1', scope: 'task', taskId: 't1' }
const SERVICE: Principal = { kind: 'internal', userId: 'u1', scope: 'service' }

const high = (digest = 'digest-a'): SecretCheckReport =>
  secretReport({ digest, findings: [{ rule: 'npm-token', confidence: 'high', location: 'src/a.ts', line: 3, column: 9 }] })

let test: TestDb
const gate = () => createSecretPublicationGate({ db: test.db, prefs: createPrefService(test.db), identity: createIdentityService(memoryIdentityStore('u1')) })
const call = (principal: Principal, method: string, path = '', body?: unknown) =>
  new Hono<AppEnv>()
    .use('*', requestIdMiddleware)
    .use('*', async (c, next) => { c.set('principal', principal); await next() })
    .use('/v1/core/security/*', requireDevice)
    .route('/v1/core/security/secret-publication', new Hono<AppEnv>()
      .get('/', readSecretPublication).put('/', writeSecretPublication).post('/allow', allowSecretPublicationOnce))
    .fetch(new Request(`http://acorn.test/v1/core/security/secret-publication${path}`, {
      method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }), { DB: test.db } as unknown as Env)
const block = (on: boolean) => createPrefService(test.db).write('u1', SECRET_PUBLICATION_PREF_KEY, String(on))

beforeEach(() => { test = makeTestDb(); resetSecretPublicationDecisions() })
afterEach(() => { test.cleanup(); vi.useRealTimers() })

describe('the secret publication gate', () => {
  it('lets everything through while blocking is off', async () => {
    expect(await gate().admit({ operation: 'commit', destination: 'main', report: high() })).toBeNull()
  })

  it('blocks high findings and incomplete checks, and only warns for heuristics', async () => {
    await block(true)
    expect((await gate().admit({ operation: 'commit', destination: 'main', report: high() }))?.reason).toBe('findings')
    const incomplete = secretReport({ digest: 'b', findings: [], unscanned: [{ location: 'a.png', reason: 'Binary content.' }] })
    expect((await gate().admit({ operation: 'send', destination: 'claude', report: incomplete }))?.reason).toBe('incomplete')
    const heuristic = secretReport({ digest: 'c', findings: [{ rule: 'jwt', confidence: 'heuristic', location: 'a', line: 1, column: 1 }] })
    expect(await gate().admit({ operation: 'push', destination: 'origin', report: heuristic })).toBeNull()
  })

  it('allows one exact operation once, and nothing that changed', async () => {
    await block(true)
    const refusal = (await gate().admit({ operation: 'push', destination: 'origin refs/heads/a', report: high() }))!
    expect((await call(DEVICE, 'POST', '/allow', { decisionId: refusal.decisionId })).status).toBe(200)

    // Changed content, destination, operation, or detector version is a different decision.
    expect(await gate().admit({ operation: 'push', destination: 'origin refs/heads/a', report: high('digest-b') })).not.toBeNull()
    expect(await gate().admit({ operation: 'push', destination: 'origin refs/heads/b', report: high() })).not.toBeNull()
    expect(await gate().admit({ operation: 'commit', destination: 'origin refs/heads/a', report: high() })).not.toBeNull()
    expect(await gate().admit({ operation: 'push', destination: 'origin refs/heads/a', report: { ...high(), detectorVersion: 'acorn-secrets/0' } })).not.toBeNull()

    expect(await gate().admit({ operation: 'push', destination: 'origin refs/heads/a', report: high() })).toBeNull()
    // Spent.
    expect(await gate().admit({ operation: 'push', destination: 'origin refs/heads/a', report: high() })).not.toBeNull()
  })

  it('expires an allowance', async () => {
    await block(true)
    vi.useFakeTimers({ toFake: ['Date'] })
    const refusal = (await gate().admit({ operation: 'export', destination: 's1', report: high() }))!
    await call(DEVICE, 'POST', '/allow', { decisionId: refusal.decisionId })
    vi.setSystemTime(Date.now() + SECRET_DECISION_TTL_MS + 1)
    expect(await gate().admit({ operation: 'export', destination: 's1', report: high() })).not.toBeNull()
  })

  it('refuses task and service callers on every verb', async () => {
    await block(true)
    const refusal = (await gate().admit({ operation: 'commit', destination: 'main', report: high() }))!
    for (const principal of [AGENT, SERVICE]) {
      expect((await call(principal, 'POST', '/allow', { decisionId: refusal.decisionId })).status).toBe(403)
      expect((await call(principal, 'PUT', '', { block: false })).status).toBe(403)
      expect((await call(principal, 'GET')).status).toBe(403)
    }
    expect(await gate().enabled()).toBe(true)
  })

  it('keeps credentials out of destinations, state, and the audit trail', async () => {
    await block(true)
    await gate().admit({ operation: 'push', destination: 'https://bot:hunter2token@github.test/o/r refs/heads/a', report: high() })
    const state = await (await call(DEVICE, 'GET')).json() as SecretPublicationState
    expect(state.block).toBe(true)
    expect(state.decisions[0]).toMatchObject({ destination: 'https://github.test/o/r refs/heads/a', highCount: 1, rules: ['npm-token'] })
    await vi.waitFor(async () => expect((await readAudit(test.db)).some((row) => row.action === 'secrets.publication.blocked')).toBe(true))
    expect(JSON.stringify(await readAudit(test.db))).not.toContain('hunter2token')
    expect(JSON.stringify(state)).not.toContain('hunter2token')
  })

  it('switches blocking from the device route', async () => {
    const state = await (await call(DEVICE, 'PUT', '', { block: true })).json() as SecretPublicationState
    expect(state.block).toBe(true)
    expect(await gate().enabled()).toBe(true)
  })
})
