import { describe, expect, it, vi } from 'vitest'
import { MAX_PLUGIN_STATE_BYTES } from '@acorn/protocol/pluginState.ts'
import { CapabilityRegistry, capabilityId } from '../server/plugin/capabilities'
import type { CoreServices } from './core'
import { pluginManifestSchema, type NodePermissions } from './pluginManifest'
import { scopeCapabilities, scopeCore } from './pluginPermissions'

// A stand-in CoreServices: this module only ever picks properties off the object, so identity is all
// the assertions need and building a real one would drag a database in for nothing.
const marker = (name: string) => ({ marker: name }) as never
const externalProjects = vi.fn(async () => [])
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
    byId: marker('byId'), byGithub: marker('byGithub'), checkouts: marker('checkouts'), externalProjects,
    config: marker('config'), assertConfigTrusted: marker('assertConfigTrusted'), setup: marker('setup'),
    create: marker('create'), update: marker('update'),
  },
} as unknown as CoreServices

// Through the schema rather than hand-built, so the defaults under test are the ones a real manifest
// would produce.
const permissions = (node: Record<string, unknown> = {}): NodePermissions =>
  pluginManifestSchema.parse({ id: 'demo', name: 'demo', version: '1', apiVersion: '1', permissions: { node } }).permissions.node

const scoped = (node: Record<string, unknown> = {}, core: CoreServices = CORE): CoreServices =>
  scopeCore(core, permissions(node), 'demo', { idsForOwner: (owner) => owner === 'demo' ? ['demo-provider'] : [] })

// The facets that are NOT reachable through `core: [...]`, whatever a manifest writes there.
const keys = (services: CoreServices) => Object.keys(services).sort()

describe('scopeCore', () => {
  it('grants nothing at all by default', () => {
    expect(keys(scoped())).toEqual([])
  })

  it('grants exactly the simple facets that were named', () => {
    const services = scoped({ core: ['git', 'tasks'] })
    expect(keys(services)).toEqual(['git', 'tasks'])
    expect(services.git).toBe(CORE.git)
    // The point of gating by omission: an undeclared facet is `undefined`, so the plugin author gets
    // a TypeError the first time they run it rather than a silent no-op in production.
    expect(services.fs).toBeUndefined()
    expect(services.models).toBeUndefined()
  })

  it('covers every simple facet name', () => {
    const all = ['fs', 'git', 'tasks', 'context', 'models', 'prefs', 'identity']
    expect(keys(scoped({ core: all }))).toEqual([...all].sort())
  })

  it('ignores a facet name this build does not have, rather than failing the plugin', () => {
    expect(keys(scoped({ core: ['git', 'quantum'] }))).toEqual(['git'])
  })

  it('keeps secrets and the process broker off unless each is asked for by name', () => {
    // Not reachable through the `core` list — these two have their own manifest booleans on purpose.
    expect(keys(scoped({ core: ['secrets', 'proc', 'exec'] }))).toEqual([])
    expect(keys(scoped({ secrets: true }))).toEqual(['secrets'])
    expect(keys(scoped({ exec: true }))).toEqual(['proc'])
  })

  it('keeps project config and its executable scripts out of the read grant', () => {
    const read = scoped({ core: ['projects:read'] }).projects
    expect(Object.keys(read).sort()).toEqual(['byGithub', 'byId', 'checkouts', 'externalProjects'])
    // The disclosure phase 5's trust prompt has to name: "read projects" includes every mapped
    // project path on the machine.
    expect(read.checkouts).toBe(CORE.projects.checkouts)
    expect(read.externalProjects).not.toBe(CORE.projects.externalProjects)
    expect((read as { config?: unknown }).config).toBeUndefined()
    expect((read as { setup?: unknown }).setup).toBeUndefined()
    expect((read as { assertConfigTrusted?: unknown }).assertConfigTrusted).toBeUndefined()
    expect((read as { create?: unknown }).create).toBeUndefined()
  })

  it('scopes external project mappings to providers registered by the loaded plugin', async () => {
    externalProjects.mockClear()
    const read = scoped({ core: ['projects:read'] }).projects

    await expect(read.externalProjects('workspace-1')).resolves.toEqual([])
    expect(externalProjects).toHaveBeenCalledWith('workspace-1', ['demo-provider'])
  })

  it('passes an explicit empty provider set when the plugin owns no providers', async () => {
    const external = vi.fn(async () => [{ connectionId: 'foreign', externalId: 'project' }])
    const services = scopeCore(
      { ...CORE, projects: { ...CORE.projects, externalProjects: external } } as CoreServices,
      permissions({ core: ['projects:read'] }),
      'demo',
      { idsForOwner: () => [] },
    )

    await services.projects.externalProjects('workspace-1')
    expect(external).toHaveBeenCalledWith('workspace-1', [])
  })

  it('makes the config grant imply identity reads and include the whole config surface', () => {
    const config = scoped({ core: ['projects:config'] }).projects
    expect(Object.keys(config).sort()).toEqual(
      ['assertConfigTrusted', 'byGithub', 'byId', 'checkouts', 'config', 'externalProjects', 'setup'],
    )
  })

  it('lets write imply read without silently implying config access', () => {
    const write = scoped({ core: ['projects:write'] }).projects
    expect(Object.keys(write).sort()).toEqual(['byGithub', 'byId', 'checkouts', 'create', 'externalProjects', 'update'])
    expect((write as { config?: unknown }).config).toBeUndefined()
  })

  it('classifies every project service method as identity, config, or write', () => {
    const read = Object.keys(scoped({ core: ['projects:read'] }).projects)
    const config = Object.keys(scoped({ core: ['projects:config'] }).projects)
    const write = Object.keys(scoped({ core: ['projects:write'] }).projects)
    expect([...new Set([...read, ...config, ...write])].sort()).toEqual(Object.keys(CORE.projects).sort())
  })

  it('scopes prefs to the loaded plugin namespace shared with its frame', async () => {
    const read = vi.fn(async (_userId: string, key: string) => key === 'plugin:demo:columns' ? '[1,2]' : null)
    const write = vi.fn(async () => {})
    const services = scoped({ core: ['prefs'] }, { ...CORE, prefs: { read, write } } as CoreServices)

    expect(await services.prefs.read('user-1', 'columns')).toBe('[1,2]')
    expect(await services.prefs.read('user-1', 'plugin:other:columns')).toBeNull()
    await services.prefs.write('user-1', 'columns', '[3]')

    expect(read).toHaveBeenNthCalledWith(1, 'user-1', 'plugin:demo:columns')
    expect(read).toHaveBeenNthCalledWith(2, 'user-1', 'plugin:demo:plugin:other:columns')
    expect(write).toHaveBeenCalledWith('user-1', 'plugin:demo:columns', '[3]')
  })

  it('applies the shared frame-state quota to node-half preference writes', async () => {
    const write = vi.fn(async () => {})
    const services = scoped(
      { core: ['prefs'] },
      { ...CORE, prefs: { read: vi.fn(async () => null), write } } as CoreServices,
    )
    await expect(services.prefs.write('user-1', 'big', 'x'.repeat(MAX_PLUGIN_STATE_BYTES + 1))).rejects.toThrow(/capped/)
    expect(write).not.toHaveBeenCalled()
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
