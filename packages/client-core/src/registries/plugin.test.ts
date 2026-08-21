import { describe, expect, it } from 'vitest'
import { paneRegistry, type PaneContribution } from './panes'
import { initClientPlugins, type ClientPlugin } from './plugin'
import { Registry } from './registry'
import { sourceRegistry, type SourceContribution } from './sources'
import { integrationFlowRegistry } from './integrationFlows'
import { uiSlotRegistry } from './slots'

// The client half of packages/node-core/src/server/plugin/host.test.ts. Registration itself is
// verified end to end by the e2e suite (S1 asserts the rail's four Source labels in order, S3 the
// nine pane labels a local task offers), because vitest here runs in a bare Node environment with no
// Solid transform and the plugin entrypoints import .tsx components. What vitest can reach is the
// host's rules: declaration order, ownership, duplicate names, enable/disable, and re-activation, and
// those are exactly what the e2e suite cannot isolate.

const pane = (id: string, extra: Partial<PaneContribution> = {}): PaneContribution => ({
  id, label: id, glyph: 'x', order: 1, component: () => null, ...extra,
})

const source = (id: string, extra: Partial<SourceContribution<never>> = {}): SourceContribution<never> => ({
  id,
  order: 1,
  glyph: 'x',
  label: id,
  promotion: {
    canPromote: () => false,
    prepare: () => Promise.reject(new Error('not promotable')),
    create: () => Promise.reject(new Error('not promotable')),
  },
  ...extra,
})

// Registries are module singletons, so every test cleans up after itself by re-activating its plugins
// with an init that registers nothing, which is the host's own removal path, exercised for free.
const clear = (...names: string[]) =>
  initClientPlugins(names.map((name) => ({ name, init: () => {} })))

describe('the client plugin host', () => {
  it('runs init in declaration order, which no registry order depends on', () => {
    const order: string[] = []
    initClientPlugins([
      { name: 'first', init: (ctx) => { order.push('first'); ctx.sources.register(source('host.first')) } },
      { name: 'second', init: (ctx) => { order.push('second'); ctx.sources.register(source('host.second')) } },
    ])
    expect(order).toEqual(['first', 'second'])
    const ids = sourceRegistry.entries().map((entry) => entry.id).filter((id) => id.startsWith('host.'))
    expect(ids).toEqual(['host.first', 'host.second'])
    clear('first', 'second')
  })

  // `activate` is the phase two plugins needed and did not have (docs/plugins.md § "Frame authoring
  // and the UI kit"): plugins/http enumerated `localStorage` and plugins/agents issued a `fetch`,
  // both inside a synchronous `init` that documents itself as registration-only.
  it('runs activate after EVERY init, in declaration order, and never for a disabled plugin', () => {
    const log: string[] = []
    const plugins: ClientPlugin[] = [
      {
        name: 'first',
        init: () => log.push('init:first'),
        // The whole reason for a second pass: by here every enabled plugin has registered, so this
        // can see a sibling's descriptor. Inside `init` the registry would still be half empty.
        activate: () => log.push(`activate:first(${paneRegistry.get('host.late') ? 'sees-late' : 'blind'})`),
      },
      { name: 'second', init: (ctx) => { log.push('init:second'); ctx.panes.register(pane('host.late')) } },
      { name: 'off', init: () => log.push('init:off'), activate: () => log.push('activate:off') },
    ]
    initClientPlugins(plugins, { disabled: ['off'] })
    expect(log).toEqual(['init:first', 'init:second', 'activate:first(sees-late)'])
    clear('first', 'second', 'off')
  })

  it('refuses two plugins with the same name', () => {
    const plugin: ClientPlugin = { name: 'dupe', init: () => {} }
    expect(() => initClientPlugins([plugin, plugin])).toThrow(/Duplicate client plugin: dupe/)
  })

  it('refuses a contribution that names another plugin as its provider', () => {
    expect(() => initClientPlugins([
      { name: 'linear', init: (ctx) => ctx.panes.register(pane('host.impostor', { providerId: 'rollbar' })) },
    ])).toThrow(/registered 'host.impostor' under provider 'rollbar'/)
    // And the plugin's own provider id is accepted, so the rule is not simply rejecting providerId.
    initClientPlugins([
      { name: 'linear', init: (ctx) => ctx.panes.register(pane('host.own', { providerId: 'linear' })) },
    ])
    expect(paneRegistry.get('host.own')).toBeDefined()
    clear('linear')
  })

  it('skips a disabled plugin but never a required one', () => {
    const result = initClientPlugins([
      { name: 'optional', init: (ctx) => ctx.panes.register(pane('host.optional')) },
      { name: 'essential', required: true, init: (ctx) => ctx.panes.register(pane('host.essential')) },
    ], { disabled: ['optional', 'essential'] })
    expect(result.skipped).toEqual(['optional'])
    expect(result.enabled).toEqual(['essential'])
    expect(paneRegistry.get('host.optional')).toBeUndefined()
    expect(paneRegistry.get('host.essential')).toBeDefined()
    clear('essential')
  })

  it('replaces a plugin\'s contributions on re-activation instead of throwing on the duplicate id', () => {
    const plugins: ClientPlugin[] = [{
      name: 'again',
      init: (ctx) => {
        ctx.panes.register(pane('host.again'))
        ctx.slots.register({ id: 'host.again.slot', slot: 'overlay', order: 1, component: () => null })
      },
    }]
    initClientPlugins(plugins)
    // Without the host taking its previous contributions back, this second call throws "pane
    // contribution already registered" and takes the whole shell down on the first pane.
    expect(() => initClientPlugins(plugins)).not.toThrow()
    expect(paneRegistry.entries().filter((entry) => entry.id === 'host.again')).toHaveLength(1)
    expect(uiSlotRegistry.entries().filter((entry) => entry.id === 'host.again.slot')).toHaveLength(1)
    clear('again')
  })

  it('removes a plugin\'s contributions when it is disabled on a later activation', () => {
    const plugins: ClientPlugin[] = [
      { name: 'toggled', init: (ctx) => ctx.panes.register(pane('host.toggled')) },
    ]
    initClientPlugins(plugins)
    expect(paneRegistry.get('host.toggled')).toBeDefined()
    initClientPlugins(plugins, { disabled: ['toggled'] })
    expect(paneRegistry.get('host.toggled')).toBeUndefined()
  })

  it('tracks a plugin-published registry the same as its own, so disable and re-activation both work', () => {
    const plugin: Registry<{ id: string; note: string }> = new Registry('plugin-owned')
    const plugins: ClientPlugin[] = [
      { name: 'publisher', init: (ctx) => ctx.contribute(plugin, { id: 'host.owned', note: 'x' }) },
    ]
    initClientPlugins(plugins)
    expect(plugin.get('host.owned')).toBeDefined()
    // Re-activation replaces rather than appending: a second bare `register` would throw on the
    // duplicate id.
    expect(() => initClientPlugins(plugins)).not.toThrow()
    expect(plugin.entries()).toHaveLength(1)
    initClientPlugins(plugins, { disabled: ['publisher'] })
    expect(plugin.get('host.owned')).toBeUndefined()
  })

  it('tracks provider-owned integration flows through activation and disable', () => {
    const flow = {
      id: 'flow-owner',
      deviceFlow: {
        start: async () => ({ deviceCode: 'd', userCode: 'u', verificationUri: 'https://example.test', expiresIn: 60, interval: 5 }),
        poll: async () => ({ status: 'expired' as const }),
      },
    }
    const plugin: ClientPlugin = { name: 'flow-owner', init: (ctx) => ctx.integrationFlows.register(flow) }
    initClientPlugins([plugin])
    expect(integrationFlowRegistry.get('flow-owner')).toBe(flow)
    expect(() => initClientPlugins([plugin])).not.toThrow()
    expect(integrationFlowRegistry.entries()).toHaveLength(1)
    initClientPlugins([plugin], { disabled: ['flow-owner'] })
    expect(integrationFlowRegistry.get('flow-owner')).toBeUndefined()
  })

  it('applies the provider-ownership rule to a plugin-published registry too', () => {
    const plugin: Registry<{ id: string; providerId?: string }> = new Registry('plugin-owned-2')
    expect(() => initClientPlugins([
      { name: 'github', init: (ctx) => ctx.contribute(plugin, { id: 'host.stamped', providerId: 'linear' }) },
    ])).toThrow(/registered 'host.stamped' under provider 'linear'/)
    expect(plugin.entries()).toEqual([])
    clear('github')
  })
})
