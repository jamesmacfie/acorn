import { Hono } from 'hono'
import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '../activeIdentity'
import { agentToolContributions } from '../agentTools/registry'
import { getContextSections } from '../agentTools/contextSections'
import { auditVocabulary } from '../audit'
import { createCoreServices, SecretService } from '../core'
import {
  registerDiscoveredSource,
  registeredDataSourceDiscoveries,
  registeredDataSources,
} from '../dataSources/registry'
import { defaultBudgets, externalIdsFor, publicProvider } from '../integrations/providerShared'
import { connectionProviderRegistry } from '../integrations/connectionProviders/registry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import { nodeAction } from '../nodeActions'
import { nodeProviders } from '../nodeProviders/registry'
import { pluginRouteContributions } from '../routes/registry'
import { runSources } from '../runs/registry'
import { SCHEDULER } from '../schedules'
import { telemetrySummary } from '../telemetry/collector'
import { wsBroadcast } from '../transport/wsHub'
import { makeTestDb, testCoreSeams } from '../../testkit/db'
import { CapabilityRegistry } from './capabilities'
import { AGENTS_CUSTOM_AGENT_REGISTRY } from './customAgents'
import {
  extensionPointId,
  extensionsFor,
  openExtensionPoint,
  openExtensionPoints,
  type ExtensionPointId,
} from './extensionPoints'
import { AGENTS_HARNESS_REGISTRY } from './harnesses'
import { hookHandlers, hookPoints } from './hooks'
import { initPlugins, type LoadedPluginBinding } from './host'
import { searchProviders } from './search'
import { catalogueSkills } from './skills'
import { taskChecks } from './taskChecks'
import type { HostPluginContext } from './types'

// One registration of every kind a plugin context offers, made through a real context, then the plugin
// torn down through the host. The table below is checked against the context's own members, so a kind
// added later fails here until it records an undo (host.ts § clearRegistrations).

// The WS hub's two slots have no read side, so the test watches the setters on their way through.
const wsSlots = vi.hoisted(() => ({ channels: new Set<string>(), streams: false }))
vi.mock('../transport/wsHub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../transport/wsHub')>()
  return {
    ...actual,
    registerWsChannelHandler: (...[prefix, handler]: Parameters<typeof actual.registerWsChannelHandler>) => {
      if (handler) wsSlots.channels.add(prefix)
      else wsSlots.channels.delete(prefix)
      actual.registerWsChannelHandler(prefix, handler)
    },
    setStreamHandlers: (...[handlers]: Parameters<typeof actual.setStreamHandlers>) => {
      wsSlots.streams = handlers !== null
      actual.setStreamHandlers(handlers)
    },
  }
})

const PLUGIN = 'teardown'
// Another plugin's point, open for the whole file, so the probe can tell a contribution that went from
// one that's merely unreadable because its point closed.
const OTHER_POINT = extensionPointId<string>('host-fixture:things')

// The registries a capability provides, faked down to a set of keys.
const scheduled = new Set<string>()
const scheduleTargets = new Set<string>()
const harnesses = new Set<string>()
const customAgents = new Set<string>()
const tracked = (keys: Set<string>, key: string) => {
  keys.add(key)
  return { dispose: () => void keys.delete(key) }
}

const provider = (id: string, capabilities: { textGeneration?: true } = {}) =>
  publicProvider({
    id,
    label: 'Teardown provider',
    glyph: 'T',
    kind: 'issue-tracker',
    connection: {
      authKind: 'api-key' as const,
      fields: [],
      connectable: true,
      disconnectable: true,
      async validate() {
        return 'secret'
      },
      normalize(_credentials, secret) {
        return { secret, label: 'Teardown provider', account: null, scopes: [], config: {}, capabilities: {} }
      },
      async test() {
        return { ok: true as const }
      },
    },
    externalIds: externalIdsFor(id),
    capabilities,
    resources: [],
    budgets: defaultBudgets,
    memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none' as const, acceptedWrites: false },
  })

let heard = false
let searched = false
const routeAt = (prefix: string) =>
  pluginRouteContributions().some((route) => route.plugin === PLUGIN && route.prefix === prefix)

type Probe = {
  register(ctx: HostPluginContext): void
  present(): boolean | Promise<boolean>
  // A member a loaded plugin's context carries but refuses to run.
  compiledOnly?: true
}

// Every member that registers something, with one registration and a way to see it in its registry.
const PROBES: Record<string, Probe> = {
  'routes.register': {
    register: (ctx) => ctx.routes.register(new Hono(), { prefix: '/router' }),
    present: () => routeAt('/router'),
  },
  'routes.fetch': {
    register: (ctx) => ctx.routes.fetch(() => new Response(), { prefix: '/fetch' }),
    present: () => routeAt('/fetch'),
  },
  'tools.register': {
    register: (ctx) =>
      ctx.tools.register({
        name: 'teardown_tool',
        description: 'A tool',
        input: z.object({}),
        scope: 'task',
        risk: 'read',
        handler: async () => null,
      }),
    present: () => agentToolContributions().some((tool) => tool.name === 'teardown_tool'),
  },
  'schedules.register': {
    register: (ctx) =>
      ctx.schedules.register({
        scheduleId: 'tick',
        name: 'Tick',
        cadence: { every: '1h' } as never,
        run: async () => {},
      }),
    present: () => scheduled.has(`${PLUGIN}:tick`),
  },
  'schedules.registerTarget': {
    register: (ctx) => ctx.schedules.registerTarget({ kind: 'teardown', parse: () => null, run: async () => {} }),
    present: () => scheduleTargets.has('teardown'),
    compiledOnly: true,
  },
  'dataSources.register': {
    register: (ctx) =>
      ctx.dataSources.register({
        sourceId: 'records',
        name: 'Records',
        singular: 'Record',
        plural: 'Records',
        identityScope: 'Stable',
        handler: `/v1/p/${PLUGIN}/source`,
      }),
    present: () =>
      registeredDataSources().some((source) => source.pluginId === PLUGIN && source.sourceId === 'records'),
  },
  // A discovery and a source it found, which goes with it.
  'dataSources.discover': {
    register: (ctx) => {
      ctx.dataSources.discover({ discoveryId: 'dynamic', handler: `/v1/p/${PLUGIN}/discover` })
      registerDiscoveredSource(
        PLUGIN,
        {
          sourceId: 'found',
          name: 'Found',
          singular: 'Found',
          plural: 'Found',
          identityScope: 'Stable',
          handler: `/v1/p/${PLUGIN}/discover`,
        },
        { parameters: {} } as never,
      )
    },
    present: () =>
      registeredDataSourceDiscoveries().some((discovery) => discovery.pluginId === PLUGIN) ||
      registeredDataSources().some((source) => source.pluginId === PLUGIN && source.sourceId === 'found'),
  },
  'nodeActions.register': {
    register: (ctx) => ctx.nodeActions.register({ actionId: 'act', name: 'Act', path: '/act' }),
    present: () => nodeAction(PLUGIN, 'act') !== undefined,
  },
  'taskChecks.register': {
    register: (ctx) => ctx.taskChecks.register({ id: 'check', check: async () => null }),
    present: () => taskChecks().some((check) => check.pluginId === PLUGIN),
  },
  'search.register': {
    register: (ctx) =>
      ctx.search.register({
        id: 'find',
        label: 'Find',
        search: async () => {
          searched = true
          return []
        },
      }),
    present: async () => {
      searched = false
      await searchProviders({ text: 'x', limit: 1, taskIds: [] })
      return searched
    },
  },
  'runs.register': {
    register: (ctx) => ctx.runs.register({ runs: '/runs' }),
    present: () => runSources().some((source) => source.pluginId === PLUGIN),
  },
  'harnesses.register': {
    register: (ctx) =>
      ctx.harnesses.register({ id: 'cli', label: 'CLI', spawn: { command: 'cli', args: [] } } as never),
    present: () => harnesses.has(`${PLUGIN}:cli`),
  },
  'customAgents.register': {
    register: (ctx) => ctx.customAgents.register({ id: 'agent', name: 'Agent', providerId: 'claude', options: {} }),
    present: () => customAgents.has(`${PLUGIN}:agent`),
  },
  'skills.register': {
    register: (ctx) =>
      ctx.skills.register({
        id: 'skill',
        dir: '/skill',
        file: '/skill/SKILL.md',
        name: 'Skill',
        description: 'A skill',
        digest: '0',
      }),
    present: () => catalogueSkills(PLUGIN).length > 0,
  },
  'extensionPoints.declare': {
    register: (ctx) => ctx.extensionPoints.declare(extensionPointId<string>(`${PLUGIN}:declared`), 'Declared'),
    present: () => openExtensionPoints().some((point) => point.id === `${PLUGIN}:declared`),
  },
  'extensionPoints.handle': {
    register: (ctx) => ctx.extensionPoints.handle(OTHER_POINT, { id: 'handled', value: 'a' }),
    present: () => extensionsFor(OTHER_POINT).some((entry) => entry.id === `${PLUGIN}:handled`),
  },
  'hooks.declare': {
    register: (ctx) => ctx.hooks.declare({ id: 'gate', label: 'Gate', payload: { id: 'string' }, allows: ['observe'] }),
    present: () => hookPoints().some((point) => point.id === `${PLUGIN}:gate`),
  },
  'hooks.handle': {
    register: (ctx) =>
      ctx.hooks.handle('host-fixture:gate', { id: 'watch', mode: 'observe', run: async () => ({}) } as never),
    present: () => hookHandlers().some((handler) => handler.pluginId === PLUGIN),
  },
  'audit.declare': {
    register: (ctx) => ctx.audit.declare({ id: 'did', label: 'Did a thing' }),
    present: () => auditVocabulary().some((entry) => entry.pluginId === PLUGIN),
  },
  'contextSections.register': {
    register: (ctx) =>
      ctx.contextSections.register({
        id: 'teardown-section',
        order: 999,
        label: 'Teardown',
        defaultIncluded: false,
        budget: {},
        assemble: async () => ({}),
        format: () => '',
      } as never),
    present: () => getContextSections().some((section) => section.id === 'teardown-section'),
  },
  // The connection provider, the integration provider and the route, each undone on its own.
  'providers.integration': {
    register: (ctx) => ctx.providers.integration(provider('teardown-tracker'), () => new Response()),
    present: () =>
      connectionProviderRegistry.get('teardown-tracker') !== undefined ||
      integrationProviderRegistry.get('teardown-tracker') !== undefined ||
      integrationProviderRegistry.routes().some((route) => route.providerId === 'teardown-tracker'),
  },
  'providers.connection': {
    register: (ctx) => ctx.providers.connection(provider('teardown-connection')),
    present: () => connectionProviderRegistry.get('teardown-connection') !== undefined,
  },
  // An adapter needs its connection provider first, and must go before it.
  'providers.model': {
    register: (ctx) => {
      ctx.providers.connection(provider('teardown-model', { textGeneration: true }))
      ctx.providers.model({
        providerId: 'teardown-model',
        recommendedModelId: 'model',
        generateText: async () => ({ text: '', modelId: 'model' }),
      })
    },
    present: () => modelProviderRegistry.get('teardown-model') !== undefined,
  },
  'providers.nodes': {
    register: (ctx) => ctx.providers.nodes({ id: 'fleet', label: 'Fleet', list: async () => [] }),
    present: () => nodeProviders().some((entry) => entry.pluginId === PLUGIN),
  },
  'events.on': {
    register: (ctx) =>
      void ctx.events.on('plugins:changed', () => {
        heard = true
      }),
    present: () => {
      heard = false
      wsBroadcast({ channel: 'plugins:changed' })
      return heard
    },
  },
  'events.channel': {
    register: (ctx) => ctx.events.channel('teardown', { onFrame: () => {}, onDisconnect: () => {} }),
    present: () => wsSlots.channels.has('teardown'),
  },
  'events.streams': {
    register: (ctx) =>
      ctx.events.streams({ input: () => {}, attach: () => {}, detach: () => {}, streamTaskId: () => null }),
    present: () => wsSlots.streams,
  },
  'core.telemetry.onBatch': {
    register: (ctx) => void ctx.core.telemetry.onBatch(() => {}),
    present: () => telemetrySummary().sinks.includes(PLUGIN),
  },
}

// Members that register nothing, so teardown has nothing to take back.
const NOT_REGISTRATIONS = new Set([
  // Reads.
  'dataSources.list',
  'dataSources.discoverAvailable',
  'dataSources.queryPublication',
  'dataSources.resolveQuery',
  'dataSources.invoke',
  'extensionPoints.handlers',
  'hooks.run',
  'hooks.handlers',
  'providers.withConnection',
  'capabilities.get',
  'capabilities.require',
  'capabilities.ids',
  'core.telemetry.enabled',
  // Writes to a table, which outlive the plugin on purpose.
  'dataSources.setQueryConsumer',
  'datasets.writeForTask',
  'audit.record',
  // Broadcasts, which are gone once sent.
  'events.send',
  'events.status',
  'events.worktreeStatus',
  'events.repoConfigTrustNotice',
  'events.notice',
  // Handles the plugin owns. The host closes storage itself, after dispose. A capability stays until its
  // provider disposes it, because a neighbour may still call it from its own dispose.
  'storage.open',
  'capabilities.provide',
])

// `ctx.telemetry` and `ctx.log` write about the plugin's own work, and `core` is host services. The one
// registration on `core` is the telemetry read facet, listed member by member.
const SKIPPED_GROUPS = new Set(['name', 'core', 'telemetry', 'log'])

function membersOf(ctx: HostPluginContext): string[] {
  const members: string[] = []
  for (const [group, value] of Object.entries(ctx)) {
    if (SKIPPED_GROUPS.has(group) || !value || typeof value !== 'object') continue
    for (const [key, member] of Object.entries(value)) if (typeof member === 'function') members.push(`${group}.${key}`)
  }
  for (const key of Object.keys(ctx.core.telemetry ?? {})) members.push(`core.telemetry.${key}`)
  return members
}

describe('plugin teardown', () => {
  const db = makeTestDb()
  let otherPoint: { dispose(): void } | null = null
  beforeAll(() => {
    otherPoint = openExtensionPoint('host-fixture', OTHER_POINT as ExtensionPointId<unknown>, 'Things')
  })
  afterAll(() => {
    otherPoint?.dispose()
    db.cleanup()
  })

  const boot = async (loaded?: LoadedPluginBinding) => {
    const capabilities = new CapabilityRegistry()
    capabilities.provide(SCHEDULER, {
      register: (schedule: { key: string }) => tracked(scheduled, schedule.key),
      registerTarget: (target: { kind: string }) => tracked(scheduleTargets, target.kind),
    } as never)
    capabilities.provide(AGENTS_HARNESS_REGISTRY, { register: (harness) => tracked(harnesses, harness.id) })
    capabilities.provide(AGENTS_CUSTOM_AGENT_REGISTRY, { register: (agent) => tracked(customAgents, agent.id) })
    let captured!: HostPluginContext
    const host = await initPlugins([{ name: PLUGIN, init: (ctx) => void (captured = ctx as HostPluginContext) }], {
      capabilities,
      core: createCoreServices({
        secrets: new SecretService('a'.repeat(64)),
        db: db.db,
        activeIdentity: memoryIdentityStore(),
        ...testCoreSeams(),
      }),
      dataDir: '',
      ...(loaded ? { loaded: new Map([[PLUGIN, loaded]]) } : {}),
    })
    return { ctx: captured, host }
  }

  const tiers: [tier: string, loaded: LoadedPluginBinding | undefined][] = [
    ['built-in', undefined],
    [
      'loaded',
      {
        permissions: { core: ['telemetry'], capabilities: [], secrets: false, exec: false, net: [], sockets: false },
        events: ['plugins:changed'],
        storage: {
          open: () => {
            throw new Error('test storage is not configured')
          },
        },
      },
    ],
  ]

  it('takes back every registration, on both context types', async () => {
    const covered = new Set<string>()
    for (const [tier, loaded] of tiers) {
      const { ctx, host } = await boot(loaded)
      const members = membersOf(ctx)
      expect(
        members.filter((member) => !(member in PROBES) && !NOT_REGISTRATIONS.has(member)),
        `${tier} members with no probe`,
      ).toEqual([])

      const probes = members.filter((member) => member in PROBES).map((member) => [member, PROBES[member]] as const)
      for (const [member, probe] of probes) {
        covered.add(member)
        expect(await probe.present(), `${tier} ${member} before registering`).toBe(false)
        if (loaded && probe.compiledOnly) {
          expect(() => probe.register(ctx), `${tier} ${member}`).toThrow()
          continue
        }
        probe.register(ctx)
        expect(await probe.present(), `${tier} ${member} registered`).toBe(true)
      }

      await host.dispose()
      for (const [member, probe] of probes)
        expect(await probe.present(), `${tier} ${member} after teardown`).toBe(false)
    }
    // And no probe outlives the member it was written for.
    expect(Object.keys(PROBES).filter((member) => !covered.has(member))).toEqual([])
  })
})
