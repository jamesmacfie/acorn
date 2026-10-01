import { describe, expect, it } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import { createApp } from '../index'
import type { Env } from '../bindings'
import { principalMayActOnTask } from './requireUser'

// One representative path per mounted /v1 router. requireUser is a global `/v1/*` gate, so an
// unauthenticated request to any of these must 401 with the ApiError envelope, before routing, before
// any handler. That the gate is one glob over both namespaces is the point: core at
// /v1/core/* and every plugin at /v1/p/<plugin>/* are covered by the same middleware, so a plugin
// cannot mount itself outside it. This table is the mount contract: a router added outside `/v1/*`
// (or a public hole) would not appear here and would silently escape the gate, so keep it
// exhaustive. (docs/security.md § Transport and auth · docs/api-reference.md § Request processing)
const PROTECTED_PATHS: [string, string][] = [
  ['GET', '/v1/core/prefs'],
  ['GET', '/v1/core/workspaces'],
  ['GET', '/v1/core/tasks'],
  ['GET', '/v1/core/tasks/t1/context'],
  ['GET', '/v1/core/tasks/t1/tools'], // harness — internal-token surface, still gated
  ['GET', '/v1/core/integrations'],
  // Device administration sits below the gate even though pairing sits above it: a device route that
  // drifted above requireUser would be an unauthenticated hole (routes/pairing.ts).
  ['GET', '/v1/core/devices'],
  ['GET', '/v1/core/plugins'], // node administration: which plugins this node runs (routes/plugins.ts)
  ['GET', '/v1/p/changes/tasks/t1/review-notes'],
  ['GET', '/v1/p/notes/tasks/t1/notes'],
  ['GET', '/v1/p/linear/projects'],
  ['GET', '/v1/p/rollbar/items'],
  ['GET', '/v1/p/github/pins'],
  ['GET', '/v1/p/github/repos'],
  ['GET', '/v1/p/github/repos/o/r/labels'],
  ['GET', '/v1/p/github/repos/o/r/pulls'],
  ['GET', '/v1/p/github/repos/o/r/pulls/1'],
  ['GET', '/v1/p/github/repos/o/r/pulls/1/files'],
  ['GET', '/v1/p/github/repos/o/r/blobs/deadbeef'],
  ['GET', '/v1/p/github/repos/o/r/actions/runs/1/jobs'],
  ['GET', '/v1/p/github/repos/o/r/mentions'],
]

describe('principal task authority without a Hono context', () => {
  it('denies absent principals and missing task claims, and compares exact task IDs', () => {
    expect(principalMayActOnTask(null, 'task-a')).toBe(false)
    expect(principalMayActOnTask(undefined, 'task-a')).toBe(false)
    expect(principalMayActOnTask({ kind: 'internal', userId: 'owner', scope: 'task' }, 'task-a')).toBe(false)
    const principal = { kind: 'internal' as const, userId: 'owner', scope: 'task' as const, taskId: 'task-a' }
    expect(principalMayActOnTask(principal, 'task-a')).toBe(true)
    expect(principalMayActOnTask(principal, 'task-a-suffix')).toBe(false)
    expect(principalMayActOnTask(principal, 'task-b')).toBe(false)
  })

  it('preserves unconfined device and service authority', () => {
    expect(principalMayActOnTask({ kind: 'device', userId: 'owner' }, 'task-b')).toBe(true)
    expect(principalMayActOnTask({ kind: 'internal', userId: 'owner', scope: 'service' }, 'task-b')).toBe(true)
  })
})

describe('requireUser gate over the protected router table', () => {
  it.each(PROTECTED_PATHS)('%s %s → 401 unauthenticated when logged out', async (method, path) => {
    const res = await createApp().fetch(new Request(`http://127.0.0.1:4317${path}`, { method }), {} as Env)
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'unauthenticated' })
  })

  it('leaves the two pairing routes outside the gate (they are how a client gets a credential)', async () => {
    // GET /v1/node is the one /v1 route an unpaired client may read; it answers 200 with the
    // pairing-only projection. Behaviour lives in apps/node/test/integration/pairing.test.ts; here we
    // only assert it is not behind requireUser, because that is this file's contract.
    const res = await createApp().fetch(new Request('http://127.0.0.1:4317/v1/node'), {} as Env)
    expect(res.status).toBe(200)
  })

  it('shows the background instance ID only to an authenticated device', async () => {
    const env = {
      NODE_ID: 'node-one', NODE_FINGERPRINT: 'fingerprint', SERVICE_INSTANCE_ID: '00000000-0000-4000-8000-000000000001',
      DEVICES: { authenticate: async () => ({ deviceId: 'device-one' }) },
      ACTIVE_IDENTITY: { get: () => 'owner-one' },
    } as unknown as Env
    const app = createApp()
    const url = 'http://127.0.0.1:4317/v1/node'
    const publicInfo = await (await app.fetch(new Request(url), env)).json() as Record<string, unknown>
    expect(publicInfo.nodeId).toBeUndefined()
    expect(publicInfo.serviceInstanceId).toBeUndefined()
    const privateInfo = await (await app.fetch(new Request(url, { headers: { authorization: 'Bearer device-token' } }), env)).json() as Record<string, unknown>
    expect(privateInfo).toMatchObject({ nodeId: 'node-one', serviceInstanceId: env.SERVICE_INSTANCE_ID })
  })

  // The /auth namespace is not part of the current API. Keep these probes so a public login surface
  // cannot be introduced without the route conformance suite noticing.
  it.each([
    ['POST', '/auth/logout'],
    ['GET', '/auth/login'],
    ['GET', '/auth/callback'],
    ['GET', '/auth/test-login'],
  ])('%s %s → 404: the /auth namespace is gone', async (method, path) => {
    const res = await createApp().fetch(new Request(`http://127.0.0.1:4317${path}`, { method }), {} as Env)
    expect(res.status).toBe(404)
  })
})
