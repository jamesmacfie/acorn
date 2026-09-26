import type { CoreServices } from '../core'
import type { NodePluginContext } from '../pluginHost/types'

type Mode = 'sync' | 'async'
type Methods<T> = { [K in keyof T as NonNullable<T[K]> extends (...args: any[]) => unknown ? K : never]: Mode }

// These are the callable methods exported by the loaded context. `satisfies` makes a new public
// method a compile error until its wire mode is chosen here. The worker uses the mode on each encoded
// function; a wrong sync mode is not repaired by the TypeScript declaration on the other side.
const modes = {
  routes: { fetch: 'sync' },
  schedules: { register: 'sync' },
  dataSources: {
    register: 'sync', discover: 'sync', list: 'async', discoverAvailable: 'async',
    invoke: 'async', resolveQuery: 'async', setQueryConsumer: 'async', queryPublication: 'async',
  },
  taskChecks: { register: 'sync' },
  runs: { register: 'sync' },
  audit: { declare: 'sync', record: 'sync' },
  extensionPoints: {
    declare: 'sync', handle: 'sync', handlers: 'sync', open: 'sync',
    contribute: 'sync', entries: 'sync',
  },
  hooks: { declare: 'sync', handle: 'sync', run: 'async' },
  providers: { integration: 'sync', connection: 'sync', model: 'sync', nodes: 'sync', withConnection: 'async' },
  capabilities: { provide: 'sync', get: 'sync', require: 'sync', ids: 'sync' },
  storage: { open: 'sync' },
  events: {
    send: 'sync', status: 'sync', worktreeStatus: 'sync', repoConfigTrustNotice: 'sync',
    notice: 'sync', on: 'sync',
  },
  telemetry: { event: 'sync', count: 'sync', gauge: 'sync', error: 'sync', measure: 'sync', startSpan: 'sync' },
  log: { debug: 'sync', info: 'sync', warn: 'sync', error: 'sync' },
  core: {
    agentToolProvenance: { verify: 'async' },
    fs: { isContainedPath: 'sync', isValidRepoIdent: 'sync', resolveInRoot: 'sync', confineExistingFile: 'async' },
    git: { git: 'async', gitOrThrow: 'async', gitText: 'async' },
    proc: { brokerEnv: 'sync', runProcess: 'async', runProcessOrThrow: 'async' },
    secrets: { use: 'async', useOptional: 'async', seal: 'async', reveal: 'async' },
    tasks: {
      load: 'async', root: 'async', requireRoot: 'async', resolveCwd: 'async', runConfig: 'async', active: 'async',
      workspaceId: 'async', workspaceIdOrNull: 'async', idsForWorkspace: 'async', links: 'async',
      pulls: 'async', attachPull: 'async', adoptPullNumbers: 'async', createChild: 'async', cancel: 'async',
    },
    context: { injectionEnabled: 'async', assemble: 'async' },
    models: { generateText: 'async', available: 'async' },
    data: { connect: 'async', disconnect: 'async', query: 'async', catalog: 'async', schema: 'async' },
    prefs: { read: 'async', write: 'async' },
    identity: { active: 'sync' },
    projects: {
      byId: 'async', byGithub: 'async', checkouts: 'async', byWorkspace: 'async',
      externalProjects: 'async', create: 'async', update: 'async', config: 'async',
      assertConfigTrusted: 'async', setup: 'async',
    },
    telemetry: { enabled: 'sync', onBatch: 'sync' },
  },
} as const satisfies {
  [K in Exclude<keyof NodePluginContext, 'name' | 'core'>]: Methods<NodePluginContext[K]>
} & { core: { [K in keyof CoreServices]: Methods<NonNullable<CoreServices[K]>> } }

export function hostFunctionMode(path: string): Mode {
  // The provider fetch handler is the second argument to providers.integration. Its request context
  // lends a provider-owned item store synchronously; the store's reads still cross as async RPC.
  if (path === 'remote.sync.args[1].args[1].providers.items') return 'sync'
  const prefix = path.startsWith('plugin.init.args[0].') ? 'plugin.init.args[0].'
    : path.startsWith('plugin.ready.args[0].') ? 'plugin.ready.args[0].' : null
  if (!prefix) return 'async'
  const method = path.slice(prefix.length)
  // A constructor is exposed as an opaque value in the published declarations. RPC cannot lend its
  // prototype; retain the existing asynchronous proxy classification for that one named value.
  if (method === 'core.proc.ProcessError') return 'async'
  // A host result may contain a registered handle or a dynamic capability implementation. Keep
  // known handle methods synchronous; every other result callback remains asynchronous.
  if (method.includes('.result')) {
    if (method === 'events.on.result.dispose' || method === 'capabilities.provide.result.dispose'
      || method === 'core.telemetry.onBatch.result.dispose' || method === 'telemetry.startSpan.result.end') return 'sync'
    return 'async'
  }
  const parts = method.split('.')
  let current: unknown = modes
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      throw new Error(`Unclassified host context method '${path}'`)
    }
    current = (current as Record<string, unknown>)[part]
  }
  if (current !== 'sync' && current !== 'async') throw new Error(`Unclassified host context method '${path}'`)
  return current
}
