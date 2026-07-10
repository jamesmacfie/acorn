import { describe, expect, it } from 'vitest'
import type { ApiError } from '../../shared/api'
import { createApp } from '../index'

// One representative path per mounted /api router. requireUser is a global `/api/*` gate, so an
// unauthenticated request to any of these must 401 with the ApiError envelope — before routing,
// before any handler. This table is the mount contract: a router added outside `/api/*` (or a
// public hole) would not appear here and would silently escape the gate, so keep it exhaustive.
// (docs/next/security.md §3, §7 · docs/next/feature-parity.md §16)
const PROTECTED_PATHS: [string, string][] = [
  ['GET', '/api/me'],
  ['GET', '/api/pins'],
  ['GET', '/api/prefs'],
  ['GET', '/api/workspaces'],
  ['GET', '/api/tasks'],
  ['GET', '/api/tasks/t1/review-notes'],
  ['GET', '/api/tasks/t1/context'],
  ['GET', '/api/tasks/t1/notes'], // harness — internal-token surface, still gated
  ['GET', '/api/integrations'],
  ['GET', '/api/linear/projects'],
  ['GET', '/api/rollbar/items'],
  ['GET', '/api/repos'],
  ['GET', '/api/repos/o/r/labels'],
  ['GET', '/api/repos/o/r/pulls'],
  ['GET', '/api/repos/o/r/pulls/1'],
  ['GET', '/api/repos/o/r/pulls/1/files'],
  ['GET', '/api/repos/o/r/blobs/deadbeef'],
  ['GET', '/api/repos/o/r/actions/runs/1/jobs'],
  ['GET', '/api/repos/o/r/mentions'],
]

describe('requireUser gate over the protected router table', () => {
  it.each(PROTECTED_PATHS)('%s %s → 401 unauthenticated when logged out', async (method, path) => {
    const res = await createApp().fetch(new Request(`http://127.0.0.1:4317${path}`, { method }), {} as Env)
    expect(res.status).toBe(401)
    expect((await res.json()) as ApiError).toEqual({ error: 'unauthenticated' })
  })

  it('leaves /auth outside the gate (public by construction)', async () => {
    // /auth/logout clears cookies and 204s without any session — proves /auth never hits requireUser.
    const res = await createApp().fetch(new Request('http://127.0.0.1:4317/auth/logout', { method: 'POST' }), {} as Env)
    expect(res.status).not.toBe(401)
  })
})
