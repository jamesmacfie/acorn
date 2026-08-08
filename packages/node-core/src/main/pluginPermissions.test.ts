import { describe, expect, it } from 'vitest'
import { CapabilityRegistry, capabilityId } from '../server/plugin/capabilities'
import type { CoreServices } from './core'
import { pluginManifestSchema, type NodePermissions } from './pluginManifest'
import { scopeCapabilities, scopeCore } from './pluginPermissions'

// A stand-in CoreServices: this module only ever picks properties off the object, so identity is all
// the assertions need and building a real one would drag a database in for nothing.
const marker = (name: string) => ({ marker: name }) as never
const CORE = {
  fs: marker('fs'),
  git: marker('git'),
  proc: marker('proc'),
  secrets: marker('secrets'),
  tasks: marker('tasks'),
  context: marker('context'),
  models: marker('models'),
  prefs: marker('prefs'),
  identity: marker('identity'),
  projects: {
    byId: marker('byId'), byGithub: marker('byGithub'), checkouts: marker('checkouts'),
    config: marker('config'), assertConfigTrusted: marker('assertConfigTrusted'), setup: marker('setup'),
    create: marker('create'), update: marker('update'),
  },
} as unknown as CoreServices

// Through the schema rather than hand-built, so the defaults under test are the ones a real manifest
// would produce.
const permissions = (node: Record<string, unknown> = {}): NodePermissions =>
  pluginManifestSchema.parse({ id: 'demo', name: 'demo', version: '1', apiVersion: '1', permissions: { node } }).permissions.node

// The facets that are NOT reachable through `core: [...]`, whatever a manifest writes there.
const keys = (services: CoreServices) => Object.keys(services).sort()

describe('scopeCore', () => {
  it('grants nothing at all by default', () => {
    expect(keys(scopeCore(CORE, permissions()))).toEqual([])
  })

  it('grants exactly the simple facets that were named', () => {
    const scoped = scopeCore(CORE, permissions({ core: ['git', 'tasks'] }))
    expect(keys(scoped)).toEqual(['git', 'tasks'])
    expect(scoped.git).toBe(CORE.git)
    // The point of gating by omission: an undeclared facet is `undefined`, so the plugin author gets
    // a TypeError the first time they run it rather than a silent no-op in production.
    expect(scoped.fs).toBeUndefined()
    expect(scoped.models).toBeUndefined()
  })

  it('covers every simple facet name', () => {
    const all = ['fs', 'git', 'tasks', 'context', 'models', 'prefs', 'identity']
    expect(keys(scopeCore(CORE, permissions({ core: all })))).toEqual([...all].sort())
  })

  it('ignores a facet name this build does not have, rather than failing the plugin', () => {
    expect(keys(scopeCore(CORE, permissions({ core: ['git', 'quantum'] })))).toEqual(['git'])
  })

  it('keeps secrets and the process broker off unless each is asked for by name', () => {
    // Not reachable through the `core` list — these two have their own manifest booleans on purpose.
    expect(keys(scopeCore(CORE, permissions({ core: ['secrets', 'proc', 'exec'] })))).toEqual([])
    expect(keys(scopeCore(CORE, permissions({ secrets: true })))).toEqual(['secrets'])
    expect(keys(scopeCore(CORE, permissions({ exec: true })))).toEqual(['proc'])
  })

  it('splits projects into read and write', () => {
    const read = scopeCore(CORE, permissions({ core: ['projects:read'] })).projects
    expect(Object.keys(read).sort()).toEqual(['assertConfigTrusted', 'byGithub', 'byId', 'checkouts', 'config', 'setup'])
    // The disclosure phase 5's trust prompt has to name: "read projects" includes every mapped
    // project path on the machine.
    expect(read.checkouts).toBe(CORE.projects.checkouts)
    expect((read as { create?: unknown }).create).toBeUndefined()
  })

  it('lets write imply read, because a writer that cannot resolve a project is useless', () => {
    const write = scopeCore(CORE, permissions({ core: ['projects:write'] })).projects
    expect(Object.keys(write).sort()).toEqual(
      ['assertConfigTrusted', 'byGithub', 'byId', 'checkouts', 'config', 'create', 'setup', 'update'],
    )
  })
})

describe('scopeCapabilities', () => {
  const greet = capabilityId<() => string>('test.greet')
  const other = capabilityId<() => string>('test.other')

  const registry = () => {
    const real = new CapabilityRegistry()
    real.provide(greet, () => 'hi')
    real.provide(other, () => 'nope')
    return real
  }

  it('reads an undeclared capability as absent, exactly like a disabled provider', () => {
    const scoped = scopeCapabilities(registry(), ['test.greet'])
    expect(scoped.get(greet)?.()).toBe('hi')
    expect(scoped.get(other)).toBeUndefined()
  })

  it('throws from require for an undeclared id, because that is a bug in the plugin', () => {
    const scoped = scopeCapabilities(registry(), ['test.greet'])
    expect(() => scoped.require(greet)).not.toThrow()
    expect(() => scoped.require(other)).toThrow(/Required capability/)
  })

  it('enumerates only what was declared', () => {
    expect(scopeCapabilities(registry(), ['test.greet']).ids()).toEqual(['test.greet'])
  })

  it('still lets the plugin publish its own capability', () => {
    const real = registry()
    const mine = capabilityId<() => string>('test.mine')
    scopeCapabilities(real, []).provide(mine, () => 'mine')
    expect(real.get(mine)?.()).toBe('mine')
  })
})
