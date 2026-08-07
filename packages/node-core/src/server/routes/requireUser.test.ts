import { describe, expect, it } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import { createApp } from '../index'
import type { Env } from '../../main/bindings'

// One representative path per mounted /v2 router. requireUser is a global `/v2/*` gate, so an
// unauthenticated request to any of these must 401 with the ApiError envelope — before routing,
// before any handler. That the gate is one glob over BOTH namespaces is the point: core at
// /v2/core/* and every plugin at /v2/p/<plugin>/* are covered by the same middleware, so a plugin
// cannot mount itself outside it. This table is the mount contract: a router added outside `/v2/*`
// (or a public hole) would not appear here and would silently escape the gate, so keep it
// exhaustive. (docs/security.md §3, §7 · docs/api-reference.md § HTTP conventions)
const PROTECTED_PATHS: [string, string][] = [
  ['GET', '/v2/core/prefs'],
  ['GET', '/v2/core/workspaces'],
  ['GET', '/v2/core/tasks'],
  ['GET', '/v2/core/tasks/t1/context'],
  ['GET', '/v2/core/tasks/t1/tools'], // harness — internal-token surface, still gated
  ['GET', '/v2/core/integrations'],
  // Device administration sits BELOW the gate even though pairing sits above it: a device route that
  // drifted above requireUser would be an unauthenticated hole (routes/pairing.ts).
  ['GET', '/v2/core/devices'],
  ['GET', '/v2/core/plugins'], // node administration: which plugins this node runs (routes/plugins.ts)
  ['GET', '/v2/p/changes/tasks/t1/review-notes'],
  ['GET', '/v2/p/memory/tasks/t1/notes'],
  ['GET', '/v2/p/linear/projects'],
  ['GET', '/v2/p/rollbar/items'],
  ['GET', '/v2/p/github/pins'],
  ['GET', '/v2/p/github/repos'],
  ['GET', '/v2/p/github/repos/o/r/labels'],
  ['GET', '/v2/p/github/repos/o/r/pulls'],
  ['GET', '/v2/p/github/repos/o/r/pulls/1'],
  ['GET', '/v2/p/github/repos/o/r/pulls/1/files'],
  ['GET', '/v2/p/github/repos/o/r/blobs/deadbeef'],
  ['GET', '/v2/p/github/repos/o/r/actions/runs/1/jobs'],
  ['GET', '/v2/p/github/repos/o/r/mentions'],
]

describe('requireUser gate over the protected router table', () => {
  it.each(PROTECTED_PATHS)('%s %s → 401 unauthenticated when logged out', async (method, path) => {
    const res = await createApp().fetch(new Request(`http://127.0.0.1:4317${path}`, { method }), {} as Env)
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'unauthenticated' })
  })

  it('leaves the two pairing routes outside the gate (they are how a client gets a credential)', async () => {
    // GET /v2/node is the one /v2 route an unpaired client may read; it answers 200 with the
    // pairing-only projection. Behaviour lives in apps/node/test/integration/pairing.test.ts — here we
    // only assert it is not behind requireUser, because that is this file's contract.
    const res = await createApp().fetch(new Request('http://127.0.0.1:4317/v2/node'), {} as Env)
    expect(res.status).toBe(200)
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
