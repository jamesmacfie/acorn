import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { ProjectRef } from '@acorn/node-core/main/projects.ts'
import type { TaskRef } from '@acorn/node-core/main/taskWorktree.ts'
import type { NodePluginContext, PluginRequestContext } from '@acorn/node-core/server/plugin/types.ts'
import type { StoredConnection } from '@acorn/node-core/server/integrations/connections.ts'
import type { ExternalItemStore } from '@acorn/node-core/server/integrations/itemStore.ts'
import type { CapabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type * as Published from './public.ts'

// The drift lock for the hand-written published declarations, copying the pattern
// packages/plugin-sdk/src/contract.test.ts established. See docs/plugins.md § What is published, and
// what acorn promises about it for why public.ts is hand-written at all.
//
// Assignability is asserted in both directions per type: one direction alone passes happily when the
// published type is a subset, so dropping a method from `core.tasks` would still let the published
// service accept a real one.

/** Both directions means structurally identical. A type error here is the point of the file. */
type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]

// ── The holes, named one at a time ────────────────────────────────────────────────────────────────
//
// Members whose type public.ts declares as `HostOwned<…>` rather than describing: a framework the
// loaded tier's line already names (drizzle, Zod), or a shape with an owner in another contract. An
// opaque type cannot take part in a two-way comparison in either direction, so each one is subtracted
// from both sides here and everything around it is still compared exactly.
//
// Adding a name to a list below is the deliberate act. It means "acorn no longer promises the shape of
// this one member", and it should be argued for in review like any other narrowing.
const HOLES = {
  context: ['storage', 'tools', 'providers', 'collections', 'contextSections', 'taskChecks'],
  tasks: ['runConfig'],
  projects: ['config', 'setup'],
  proc: ['ProcessError'],
} as const

// Two shapes the published types leave as type parameters rather than describing: a stored connection
// row (a drizzle-inferred core table row) and core's external-item store. Both belong to the
// integrations contract and only a plugin that owns an integration provider ever sees them. Passing the
// real ones here is what lets `routes` and the request context be compared in full, which matters more
// than the two shapes do: every loaded plugin serves routes and almost none owns a provider.
type Real = [StoredConnection, ExternalItemStore]

type Hole<C, K extends keyof C | string> = Omit<C, K>

/** `export const GIT_TIMEOUT_MS = 30_000` has the literal type `30000`, not `number`. Publishing the
 *  literal would make a tuning change a plugin API change, so the published declarations say `number`
 *  and both sides are widened here before they are compared. */
type WidenNumbers<T> = { [K in keyof T]: T[K] extends number ? number : T[K] }

// The loaded tier's projection of the real context: no `routes.register`, no `events.channel`, no
// `events.streams`. The host withholds all three whatever a manifest says (docs/extensibility.md §
// Two tiers, permanently), and the published type describes the tier a stranger can write.
type LoadedContext = Omit<NodePluginContext, 'routes' | 'events' | 'core'> & {
  routes: Omit<NodePluginContext['routes'], 'register'>
  events: Omit<NodePluginContext['events'], 'channel' | 'streams'>
  core: WidenNumbers<Omit<CoreServices, 'tasks' | 'projects' | 'proc' | 'context' | 'models' | 'secrets' | 'git'>>
}
type PublishedContext = Omit<Published.NodePluginContext<Real[0], Real[1]>, 'core'> & {
  core: WidenNumbers<Omit<Published.CoreServices, 'tasks' | 'projects' | 'proc' | 'context' | 'models' | 'secrets' | 'git'>>
}

const _context: Mutual<Hole<LoadedContext, (typeof HOLES.context)[number]>, Hole<PublishedContext, (typeof HOLES.context)[number]>> = [true, true]
const _task: Mutual<TaskRef, Published.TaskRef> = [true, true]
const _project: Mutual<ProjectRef, Published.ProjectRef> = [true, true]
const _capabilityId: Mutual<CapabilityId<string>, Published.CapabilityId<string>> = [true, true]
const _capabilities: Mutual<NodePluginContext['capabilities'], Published.PluginCapabilities> = [true, true]
const _fs: Mutual<CoreServices['fs'], Published.CoreServices['fs']> = [true, true]
const _git: Mutual<WidenNumbers<CoreServices['git']>, WidenNumbers<Published.CoreServices['git']>> = [true, true]
const _prefs: Mutual<CoreServices['prefs'], Published.CoreServices['prefs']> = [true, true]
const _identity: Mutual<CoreServices['identity'], Published.CoreServices['identity']> = [true, true]
const _proc: Mutual<WidenNumbers<Hole<CoreServices['proc'], (typeof HOLES.proc)[number]>>, WidenNumbers<Hole<Published.CoreServices['proc'], (typeof HOLES.proc)[number]>>> = [true, true]
const _tasks: Mutual<Hole<CoreServices['tasks'], (typeof HOLES.tasks)[number]>, Hole<Published.CoreServices['tasks'], (typeof HOLES.tasks)[number]>> = [true, true]
const _projects: Mutual<Hole<CoreServices['projects'], (typeof HOLES.projects)[number]>, Hole<Published.CoreServices['projects'], (typeof HOLES.projects)[number]>> = [true, true]
const _request: Mutual<PluginRequestContext, Published.PluginRequestContext<Real[0], Real[1]>> = [true, true]
void [_context, _task, _project, _capabilityId, _capabilities, _fs, _git, _prefs, _identity, _proc, _tasks, _projects, _request]

it('leaves most of the surface compared, not substituted', () => {
  // What the assertions above cannot catch: the hole lists growing until the comparison is vacuous.
  // These numbers are the budget. Raising one is a decision; lowering one is progress.
  expect(HOLES.context).toHaveLength(6)
  expect(Object.values(HOLES).flat()).toHaveLength(10)
  // Nine of the context's fifteen members are compared in full, `core` facet by facet above, and
  // that is where most of the surface a plugin actually calls lives.
  const published: Array<keyof Published.NodePluginContext> = [
    'name', 'routes', 'tools', 'schedules', 'collections', 'taskChecks',
    'contextSections', 'runs', 'audit', 'extensionPoints', 'providers', 'capabilities', 'storage', 'core', 'events',
  ]
  expect(published.length - HOLES.context.length).toBe(9)
})

it('names every capability the first-party plugins publish', () => {
  // The discovery half of the capability work: eleven of these ids are declared in
  // `plugins/*/src/contract/` modules a loaded plugin cannot import.
  const ids: Array<keyof Published.CapabilityCatalogue> = [
    'agents.sessionExecute', 'agents.runtime', 'agents.harnessRegistry', 'core.taskWorktreeCreated',
    'terminal.sessions', 'terminal.sendToAgent', 'terminal.runTargets', 'notes.store', 'notes.seedTask',
    'memory.knowledge', 'github.mirror', 'preview.rules', 'workflows.runner', 'workflows.notices',
  ]
  expect(new Set(ids).size).toBe(14)
})

it('declares no runtime, which is what makes it publishable as a .d.ts', () => {
  // The build copies src/public.ts to dist/index.d.ts, so anything with a runtime form would land in a
  // declaration file and either fail to parse or ship code a stranger has to bundle. Checked on the
  // text, because there is nothing to import: the module has no runtime exports by construction.
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'public.ts'), 'utf8')
  expect(source).not.toMatch(/^export (const|let|var|function|class|enum)\b/m)
  expect(source).not.toMatch(/^import /m)
})
