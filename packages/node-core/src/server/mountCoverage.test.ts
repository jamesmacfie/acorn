import { describe, expect, it } from 'vitest'
import { createApp } from './index'
import { requireDevice, requireProviderAccess, requireTaskScope } from './middleware/requireUser'
import { CORE_NAMESPACE } from './routes/registry'
import { mountCovers, registeredHandler } from '../testkit/mountCoverage'

// Every core route is reachable by a task-scoped agent token unless something says otherwise, because
// `requireUser` accepts either credential kind. A route that should be device-only but is mounted at
// `requireUser` because nobody wrote the line is a hole nothing else fails on.
//
// This test is that failure. It reads the mount table the way a request does, off the built app rather
// than out of the source text, and asserts every route under /v1/core is either covered by a gate mount
// or named below with the reason it is open. Adding a route under an already-gated prefix stays free;
// adding one anywhere else is a decision someone has to write down.
//
// Modelled on the `child_process` allowlist in tools/arch/boundaries.test.ts, and it lives in
// node-core rather than tools/arch because it needs to build the app, not parse it.

// Reachable by a task-scoped internal token on purpose. `${METHOD} ${path}` exactly as the app
// registers it.
const OPEN_TO_A_TASK_TOKEN: Record<string, string> = {
  // Filtered rather than gated, in the handler: a confined caller is answered with its own task and
  // nothing else. Gating these would break the agent surfaces that legitimately ask about their own
  // task; leaving them unfiltered would hand over every other task's title, branch and worktree path.
  'GET /v1/core/tasks': 'routes/tasks.ts filters the list by mayActOnTask',
  'GET /v1/core/task-statuses': 'routes/worktree.ts filters the roster by mayActOnTask',
  'GET /v1/core/task-scripts': 'routes/projects/taskScripts.ts filters the ids by mayActOnTask',

  // A task row is inert. It records intent — a title, a project, a branch name — and nothing on it
  // runs until a person opens it, at which point the worktree and setup paths apply their own gates.
  // Same reasoning as `POST /v1/core/projects/:id/detect` in the frame scope table.
  'POST /v1/core/tasks': 'creates an inert row; every executable path off it is separately gated',

  // The static tool catalog: names, descriptions and risk tiers, no task data and no owner data. An
  // agent already sees the tools it may call at /tasks/:id/tools, which this cannot widen.
  'GET /v1/core/agent-tools': 'static catalog, no task or owner data',

  // Filtered rather than gated, like the two task reads above and for the same reason: "what is
  // running for me" is a fair question for an agent about its own task, and the unfiltered answer
  // enumerates every task on the machine. A run with no task is never shown to a confined caller.
  'GET /v1/core/runs': 'routes/runs.ts filters the merged list by mayActOnTask',
}

const GATES = new Map<unknown, string>([
  [requireDevice, 'requireDevice'],
  [requireProviderAccess, 'requireProviderAccess'],
  [requireTaskScope, 'requireTaskScope'],
])

describe('core mount coverage', () => {
  const routes = createApp().routes.map((route) => ({ ...route, handler: registeredHandler(route.handler) }))
  // `.use()` registers as ALL; nothing under /v1/core is registered with `app.all`, so the two are the
  // same set here.
  const gateMounts = routes.filter((r) => r.method === 'ALL' && GATES.has(r.handler))
  const coreRoutes = routes.filter((r) => r.method !== 'ALL' && r.path.startsWith(`${CORE_NAMESPACE}/`))

  const gateFor = (path: string): string | null => {
    for (const mount of gateMounts) if (mountCovers(mount.path, path)) return GATES.get(mount.handler)!
    return null
  }

  it('mountCovers reads a mount path the way Hono does', () => {
    expect(mountCovers('/v1/core/prefs', '/v1/core/prefs')).toBe(true)
    expect(mountCovers('/v1/core/prefs', '/v1/core/prefs/x')).toBe(false)
    expect(mountCovers('/v1/core/prefs/*', '/v1/core/prefs')).toBe(false)
    expect(mountCovers('/v1/core/prefs/*', '/v1/core/prefs/x/y')).toBe(true)
    expect(mountCovers('/v1/core/tasks/:id/*', '/v1/core/tasks/:id/run/:target/start')).toBe(true)
    expect(mountCovers('/v1/core/tasks/:id', '/v1/core/tasks')).toBe(false)
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
