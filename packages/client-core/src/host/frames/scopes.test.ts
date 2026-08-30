import { describe, expect, it } from 'vitest'
import * as api from '@acorn/protocol/api.ts'
import { allowApi, classifyPath, describeScope, GRANTABLE_SCOPES } from './scopes'

// The exhaustive sweep is the point of this file. Everything else here is a spot check on a case the
// phase doc calls out by name (docs/plugins.md
// checklist); the sweep is what makes a new core route fail the build until someone decides whether a
// sandboxed plugin frame may reach it.

const ID = 'x'

// Every route constant @acorn/protocol exports, driven with placeholder ids. Discovered by walking the
// module rather than listed, so a route added tomorrow is included without anyone remembering to.
const routePaths = (): { name: string; path: string }[] =>
  Object.entries(api)
    .filter(([name]) => name.endsWith('Route'))
    .map(([name, value]) => {
      if (typeof value === 'string') return { name, path: value }
      // One argument, whatever the builder's arity: a missing second id interpolates as the literal
      // "undefined", which is a perfectly good opaque segment for matching purposes. Passing a second
      // is what breaks: some builders take an array there, not an id.
      if (typeof value === 'function') return { name, path: (value as (id: string) => string)(ID) }
      return { name, path: '' }
    })
    .filter((entry) => entry.path.startsWith('/v2/core'))

describe('the route table covers every core route', () => {
  it('finds routes to sweep at all', () => {
    // Anti-vacuity: this test is a loop over a discovered list, and a discovery that quietly returned
    // nothing would pass.
    expect(routePaths().length).toBeGreaterThan(30)
  })

  it('classifies every core route the protocol declares', () => {
    const unclassified = routePaths().filter((entry) => classifyPath(entry.path) === null)
    // A route here is not a bug in this test. It is a decision nobody has made yet. Add it to RULES
    // in scopes.ts, with an empty `scopes` and a note if a plugin must never reach it.
    expect(unclassified.map((entry) => `${entry.name} ${entry.path}`)).toEqual([])
  })

  it('grants only scopes on the published list', () => {
    expect(GRANTABLE_SCOPES).toEqual([
      'core.projects:config',
      'core.projects:read',
      'core.projects:write',
      'core.tasks:read',
      'core.tasks:write',
      'core.workspaces:read',
    ])
  })

  it('has owner-written consent copy for every grantable scope, and names the risky ones', () => {
    // The copy is free to change: the update diff keys on the scope name, not the sentence
    // (plugins/permissions.ts). What must not drift is that every grantable scope has a description,
    // and that the three handing over where code lives on disk are marked high.
    expect(GRANTABLE_SCOPES.map((scope) => [scope, describeScope(scope)?.text])).toEqual([
      ['core.projects:config', 'Read every project’s build, dev and database scripts'],
      ['core.projects:read', 'Read projects, including where every codebase lives on disk'],
      ['core.projects:write', 'Create and update projects, including their on-disk locations'],
      ['core.tasks:read', 'Read tasks'],
      ['core.tasks:write', 'Create and update tasks'],
      ['core.workspaces:read', 'Read workspaces'],
    ])
    expect(GRANTABLE_SCOPES.every((scope) => (describeScope(scope)?.icon.length ?? 0) > 0)).toBe(true)
    expect(GRANTABLE_SCOPES.filter((scope) => describeScope(scope)?.high)).toEqual([
      'core.projects:config',
      'core.projects:read',
      'core.projects:write',
    ])
  })

  it('never grants a mutating method on an owner or execution surface', () => {
    // The blunt sweep: whatever the table says, no scope may reach any of these paths with anything.
    const forbidden = [
      api.coreSecurityRoute,
      api.coreAuditRoute,
      api.coreBackupRoute,
      api.coreDevicesRoute,
      api.coreDeviceRoute(ID),
      api.corePluginsRoute,
      api.corePluginBundleRoute(ID),
      api.corePluginInstallRoute,
      api.corePluginUpdateRoute(ID),
      api.corePluginReloadRoute(ID),
      api.corePluginRoute(ID),
      // The sharpest of the family since approval-mediated install: an agent raises a request precisely
      // because it cannot install, and a frame that could POST the answer would close that loop for it.
      api.corePluginRequestRoute(ID),
      api.prefsRoute,
      api.agentToolsCatalogRoute,
      api.rendererAgentToolRoute(ID, 'tool'),
      api.runTargetsRoute(ID),
      api.runStartRoute(ID, ID),
      api.runStopRoute(ID, ID),
      api.runStatusRoute(ID, ID),
      api.runDefaultUrlRoute(ID),
      api.repoConfigTrustRoute(ID),
      api.taskPreviewUrlRoute(ID),
      api.taskOnCreatedRoute(ID),
      api.taskMcpRoute(ID),
      api.taskMcpStarterRoute(ID),
      api.projectRunTargetsRoute(ID),
      api.workspaceBootstrapRoute,
      api.integrationsRoute,
      api.integrationRoute(ID),
      api.integrationTestRoute(ID),
    ]
    // A manifest declaring every scope the table knows: if any of these were reachable at all, it
    // would be reachable here.
    const everything = { pluginId: 'board', api: GRANTABLE_SCOPES }
    const reachable = forbidden.flatMap((path) =>
      (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)
        .filter((method) => allowApi(everything, method, path).allowed)
        .map((method) => `${method} ${path}`),
    )
    expect(reachable).toEqual([])
  })
})

describe('the code-execution path', () => {
  // Asserted directly rather than trusted to the table, because this is the one denial whose failure
  // mode is arbitrary code execution on the Node: config writes are shell commands a later task runs.
  const importer = { pluginId: 'board', api: ['core.projects:config', 'core.projects:write'] }
  const reader = { pluginId: 'board', api: ['core.projects:read'] }

  it('denies the project config write to a frame that holds core.projects:write', () => {
    expect(allowApi(importer, 'PUT', api.projectConfigRoute(ID))).toEqual({
      allowed: false,
      reason: `PUT ${api.projectConfigRoute(ID)} cannot be granted to a plugin`,
    })
  })

  it('keeps project config reads behind their own scope', () => {
    expect(allowApi(reader, 'GET', api.projectConfigRoute(ID))).toEqual({
      allowed: false,
      reason: 'missing scope core.projects:config',
    })
    expect(allowApi(importer, 'GET', api.projectConfigRoute(ID)).allowed).toBe(true)
    expect(allowApi(reader, 'PUT', api.projectConfigRoute(ID)).allowed).toBe(false)
    expect(allowApi(importer, 'PUT', api.projectConfigRoute(ID)).allowed).toBe(false)
  })

  it('denies the run-targets write to the same frame, by any method', () => {
    for (const method of ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'] as const) {
      expect(allowApi(importer, method, api.projectRunTargetsRoute(ID)).allowed).toBe(false)
    }
  })

  it('still lets that frame do the importer job it needs', () => {
    expect(allowApi(importer, 'POST', api.projectsRoute).allowed).toBe(true)
    expect(allowApi(importer, 'POST', api.projectDetectRoute(ID)).allowed).toBe(true)
    expect(allowApi(importer, 'GET', api.projectConfigRoute(ID)).allowed).toBe(true)
  })

  it('denies deleting a project even with write', () => {
    expect(allowApi(importer, 'DELETE', api.projectRoute(ID)).allowed).toBe(false)
  })
})

describe('scope checking', () => {
  const board = { pluginId: 'board', api: ['core.tasks:read'] }

  it('allows a declared read', () => {
    expect(allowApi(board, 'GET', api.tasksRoute).allowed).toBe(true)
    expect(allowApi(board, 'GET', api.taskRoute(ID)).allowed).toBe(true)
    expect(allowApi(board, 'GET', api.taskContextRoute(ID, 'all')).allowed).toBe(true)
  })

  it('denies the write half of a scope it only declared read for', () => {
    expect(allowApi(board, 'POST', api.tasksRoute)).toEqual({ allowed: false, reason: 'missing scope core.tasks:write' })
  })

  it('allows adding a task link with task write, but never allows unlinking', () => {
    const writer = { pluginId: 'board', api: ['core.tasks:write'] }
    expect(allowApi(writer, 'POST', api.taskLinksRoute(ID)).allowed).toBe(true)
    expect(allowApi(board, 'POST', api.taskLinksRoute(ID))).toEqual({
      allowed: false,
      reason: 'missing scope core.tasks:write',
    })
    expect(allowApi(writer, 'DELETE', api.taskLinksRoute(ID)).allowed).toBe(false)
    expect(allowApi(board, 'DELETE', api.taskLinksRoute(ID)).allowed).toBe(false)
  })

  it('does not let a read on the task collection leak the task’s MCP or preview credentials', () => {
    // The reason the table names paths instead of globbing `/v2/core/tasks*`.
    expect(allowApi(board, 'GET', api.taskMcpStarterRoute(ID)).allowed).toBe(false)
    expect(allowApi(board, 'GET', api.taskPreviewUrlRoute(ID)).allowed).toBe(false)
  })

  it('denies everything when the manifest declared nothing', () => {
    expect(allowApi({ pluginId: 'board', api: [] }, 'GET', api.tasksRoute).allowed).toBe(false)
  })
})

describe('plugin namespaces', () => {
  const board = { pluginId: 'board', api: [] as string[] }

  it('always allows the plugin’s own routes, with no scope declared', () => {
    expect(allowApi(board, 'GET', '/v2/p/board/cards').allowed).toBe(true)
    expect(allowApi(board, 'POST', '/v2/p/board').allowed).toBe(true)
  })

  it('denies another plugin’s namespace', () => {
    expect(allowApi(board, 'GET', '/v2/p/github/pulls')).toEqual({ allowed: false, reason: 'another plugin’s namespace' })
  })

  it('does not treat a prefix of its own id as its own', () => {
    // `/v2/p/board-admin` is a different plugin, not a subpath of `board`.
    expect(allowApi(board, 'GET', '/v2/p/board-admin/x').allowed).toBe(false)
  })
})

describe('malformed paths', () => {
  const board = { pluginId: 'board', api: ['core.tasks:read'] }

  it('rejects anything that is not an absolute path', () => {
    for (const path of ['https://evil.test/v2/core/tasks', 'v2/core/tasks', '//evil.test/v2/core/tasks']) {
      expect(allowApi(board, 'GET', path).allowed).toBe(false)
    }
  })

  it('rejects traversal', () => {
    expect(allowApi(board, 'GET', '/v2/core/tasks/../security').allowed).toBe(false)
  })

  it('rejects a method it does not know', () => {
    expect(allowApi(board, 'HEAD', api.tasksRoute).allowed).toBe(false)
  })
})
