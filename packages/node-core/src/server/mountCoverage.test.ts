import { describe, expect, it } from 'vitest'
import { createApp } from './index'
import { requireDevice, requireProviderAccess, requireTaskScope } from './middleware/requireUser'
import { CORE_NAMESPACE } from './routeRegistry'

// Every core route is reachable by a task-scoped agent token unless something says otherwise, because
// `requireUser` accepts either credential kind. Three route reviews in a row found the same shape of
// hole: a route that should have been device-only was mounted at `requireUser` because nobody wrote
// the line, and nothing failed when they didn't.
//
// This test is that failure. It reads the mount table the way a request does — off the built app, not
// out of the source text — and asserts every route under /v2/core is either covered by a gate mount or
// named below with the reason it is open. Adding a route under an already-gated prefix stays free;
// adding one anywhere else is now a decision someone has to write down.
//
// Modelled on the `child_process` allowlist in tools/arch/boundaries.test.ts, and it lives in
// node-core rather than tools/arch because it needs to build the app, not parse it.

// Reachable by a task-scoped internal token on purpose. `${METHOD} ${path}` exactly as the app
// registers it.
const OPEN_TO_A_TASK_TOKEN: Record<string, string> = {
  // Filtered rather than gated, in the handler: a confined caller is answered with its own task and
  // nothing else. Gating these would break the agent surfaces that legitimately ask about their own
  // task; leaving them unfiltered handed over every other task's title, branch and worktree path.
  'GET /v2/core/tasks': 'routes/tasks.ts filters the list by mayActOnTask',
  'GET /v2/core/task-statuses': 'routes/worktree.ts filters the roster by mayActOnTask',

  // A task row is inert. It records intent — a title, a project, a branch name — and nothing on it
  // runs until a person opens it, at which point the worktree and setup paths apply their own gates.
  // Same reasoning as `POST /v2/core/projects/:id/detect` in the frame scope table.
  'POST /v2/core/tasks': 'creates an inert row; every executable path off it is separately gated',

  // The static tool catalog: names, descriptions and risk tiers, no task data and no owner data. An
  // agent already sees the tools it may call at /tasks/:id/tools, which this cannot widen.
  'GET /v2/core/agent-tools': 'static catalog, no task or owner data',

  // Read-only panel data, argued at the route itself (routes/dashboards.ts). An agent rendering a
  // dashboard is a legitimate reader, and there is no write route to reach.
  'GET /v2/core/dashboards/history': 'read-only measure series; see the comment on the route',

  // Filtered rather than gated, like the two task reads above and for the same reason: "what is
  // running for me" is a fair question for an agent about its own task, and the unfiltered answer
  // enumerates every task on the machine. A run with no task is never shown to a confined caller.
  'GET /v2/core/runs': 'routes/runs.ts filters the merged list by mayActOnTask',
}

const GATES = new Map<unknown, string>([
  [requireDevice, 'requireDevice'],
  [requireProviderAccess, 'requireProviderAccess'],
  [requireTaskScope, 'requireTaskScope'],
])

// Does a `.use()` mount path cover a route path? Deliberately stricter than the router: `*` here
// matches one or more further segments and never the bare path, whereas the Hono this repo pins does
// match the bare path too. The strict reading is what makes this test demand both mount forms, so a
// gate stays correct if that behaviour moves again in a Hono upgrade. A `:param` on either side
// matches one segment, so a gate at `/tasks/:id/*` covers `/tasks/:id/run/:target/start`.
export function mountCovers(mount: string, route: string): boolean {
  const m = mount.split('/')
  const r = route.split('/')
  for (let i = 0; i < m.length; i++) {
    if (m[i] === '*') return r.length > m.length - 1
    if (i >= r.length) return false
    if (m[i] !== r[i] && !m[i].startsWith(':')) return false
  }
  return m.length === r.length
}

describe('core mount coverage', () => {
  const routes = createApp().routes
  // `.use()` registers as ALL; nothing under /v2/core is registered with `app.all`, so the two are the
  // same set here.
  const gateMounts = routes.filter((r) => r.method === 'ALL' && GATES.has(r.handler))
  const coreRoutes = routes.filter((r) => r.method !== 'ALL' && r.path.startsWith(`${CORE_NAMESPACE}/`))

  const gateFor = (path: string): string | null => {
    for (const mount of gateMounts) if (mountCovers(mount.path, path)) return GATES.get(mount.handler)!
    return null
  }

  it('mountCovers reads a mount path the way Hono does', () => {
    expect(mountCovers('/v2/core/prefs', '/v2/core/prefs')).toBe(true)
    expect(mountCovers('/v2/core/prefs', '/v2/core/prefs/x')).toBe(false)
    expect(mountCovers('/v2/core/prefs/*', '/v2/core/prefs')).toBe(false)
    expect(mountCovers('/v2/core/prefs/*', '/v2/core/prefs/x/y')).toBe(true)
    expect(mountCovers('/v2/core/tasks/:id/*', '/v2/core/tasks/:id/run/:target/start')).toBe(true)
    expect(mountCovers('/v2/core/tasks/:id', '/v2/core/tasks')).toBe(false)
  })

  it('the app really is mounted, so an empty pass cannot look like a green one', () => {
    expect(coreRoutes.length).toBeGreaterThan(50)
    expect(gateMounts.length).toBeGreaterThan(10)
  })

  it('every core route is gated or named as open to a task token', () => {
    const ungated = coreRoutes
      .filter((r) => !gateFor(r.path))
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !OPEN_TO_A_TASK_TOKEN[key])
    expect([...new Set(ungated)].sort()).toEqual([])
  })

  it('the allowlist has no stale entries', () => {
    const live = new Set(coreRoutes.map((r) => `${r.method} ${r.path}`))
    const gone = Object.keys(OPEN_TO_A_TASK_TOKEN).filter((key) => !live.has(key) || !!gateFor(key.split(' ')[1]))
    expect(gone.sort()).toEqual([])
  })
})
