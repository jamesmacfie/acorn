import type { ServerType } from '@hono/node-server'
import { join } from 'node:path'
import type { ServiceEndpoint, ServiceStartConfig, ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { mintInternalToken, type InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { beginLoginShellPath } from '@acorn/node-core/server/core/loginShellPath.ts'
import { disabledPluginsStore } from '@acorn/node-core/server/plugins/disabled.ts'
import { PLUGIN_STATE } from '@acorn/node-core/server/pluginHost/state.ts'
import { buildPluginDeps } from './pluginDeps'
import { buildPluginStateBridge, effectiveDisabled } from './pluginState'
import { closeListener, makeRuntime, startListener } from '@acorn/node-core/server/transport/listener.ts'
import { openDataRoot, type DataRoot } from '@acorn/node-core/server/storage/dataRoot.ts'
import { setWorktreesRoot } from '@acorn/node-core/server/worktrees/taskWorktree.ts'
import { createScheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { launcherSpec, serverName } from '@acorn/node-core/server/mcpRegister.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { configureTerminalMcp, refreshAcornMcpRegistrations } from '@acorn/plugin-terminal/node/index.ts'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import { PREVIEW_RULES } from '@acorn/plugin-preview/contract/rules.ts'
import { dumpPerf } from '@acorn/node-core/server/perf.ts'
import { assembleNodeGraph, drainNode, reconcileBundledPackages, reconcileNode } from './composition'

export type ServiceRuntime = {
  previewRules(taskId: string): Promise<PreviewBrowserRule[]>
  stop(): Promise<void>
  // What the parent needs to reach this node: where it bound, who it is, and the bearer to use.
  // Reported rather than assumed, so a second node on the same machine is just another endpoint.
  started: ServiceStartResult
}

type RuntimeOptions = {
  config: ServiceStartConfig
  stateChanged(state: ServiceState, detail?: string): void
}

// The node's cold-start account, one line per step, and unconditional: a node that took eleven seconds
// to bind should say so without anyone having asked for it. Per-request timing is the opposite and sits
// behind ACORN_PERF=1 (node-core server/perf.ts).
//
// Two numbers per line, because both questions get asked. `+Nms` is the offset from the first line, so
// a person can read the shape of a boot down the column; `(Nms)` is this step alone, so the one step
// that cost the boot is the one wide number. The plugin passes are named per plugin because `install`
// alone cannot say which plugin was the slow one. Those lines are wall-clock slices rather than
// per-plugin costs, because the passes overlap: a plugin's line says when it finished
// (docs/local-development.md § Timing a cold start).
function bootTimer(): (label: string) => void {
  const started = process.hrtime.bigint()
  let previous = started
  return (label) => {
    const now = process.hrtime.bigint()
    const ms = (from: bigint) => (Number(now - from) / 1e6).toFixed(0)
    console.log(`[service:boot] ${label} +${ms(started)}ms (${ms(previous)}ms)`)
    previous = now
  }
}

// Shell-free composition root (docs/architecture-overview.md § Process ownership). The runtime takes
// no native surface, so importing this module in a plain Node test loads no shell.
export async function startServiceRuntime({ config, stateChanged }: RuntimeOptions): Promise<ServiceRuntime> {
  const mark = bootTimer()
  // Started, not awaited. On a packaged macOS build this spawns a login shell to recover the owner's
  // PATH, which takes half a second to two seconds on a profile with a version manager in it. The
  // PATH is for spawning agents and build commands later, so the first spawn waits on it instead of
  // the whole boot (node-core server/core/loginShellPath.ts, docs/node-distribution.md § Boot order).
  beginLoginShellPath(config.isPackaged)
  mark('login-shell')
  configureTerminalMcp(
    serverName(config.isPackaged),
    launcherSpec(config.hostRuntimePath, config.mcpEntry, serverName(config.isPackaged)),
  )

  let server: ServerType | null = null
  let endpoint: ServiceEndpoint | null = null
  // The pin the parent hands to its connection broker. Reported by the listener rather than read from
  // disk here, so there is exactly one place that decides what identity this node is answering with.
  let identity: { fingerprint: string; certPem: string } | null = null
  let disposePlugins: (() => Promise<void>) | null = null
  let reconcileTask: Promise<void> | null = null
  let stopped = false
  let dbClosed = false
  let pluginStateCapability: { dispose(): void } | null = null
  let scheduler: ReturnType<typeof createScheduler> | null = null
  let schedulerCapability: { dispose(): void } | null = null

  stateChanged('migrating')
  let dataRoot: DataRoot
  let runtime: ReturnType<typeof makeRuntime>
  try {
    // Mints/reads the nodeId and takes the root's exclusive lock. A second node on the same root
    // fails here with an actionable message rather than corrupting it.
    dataRoot = openDataRoot(config.dataDir)
  } catch (error) {
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    throw error
  }
    // One reporter for both hosts (docs/node-distribution.md § Plugins), so the account of what
    // reconciliation did cannot exist on only one root.
  reconcileBundledPackages({
    dataDir: config.dataDir,
    bundledRoot: config.bundledPluginsDir,
    development: !config.isPackaged,
  })
  mark('bundled-packages')
  const capabilities = new CapabilityRegistry()
  try {
    runtime = makeRuntime(dataRoot, config.version, capabilities)
  } catch (error) {
    dataRoot.release()
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    throw error
  }
  const db = runtime.DB
  // Read before the plugin host runs and before any route can answer, which is why it is a file in the
  // data root rather than a settings row: the list decides which databases get opened at all.
  const disabledPlugins = disabledPluginsStore(config.dataDir)
  const disabled = effectiveDisabled(disabledPlugins, config.disabledPlugins)

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    stateChanged('draining')
    // Same bounded order as server/standalone.ts (docs/node-distribution.md § Operations). The
    // listener closes first, so nothing new arrives while the rest tears down.
    //
    // Each table-owning plugin's WAL-mode SQLite file closes inside that plugin's own dispose
    // (server/pluginHost/host.ts), along with everything else that plugin owns, so this list never has to
    // grow when a new plugin needs teardown.
    //
    // The root lock releases last, once SQLite is closed, or a restart could open the database while
    // this process still holds its WAL. A drain that hits the deadline leaves the lock to dataRoot's
    // own `process.on('exit')` hook, which is why missing it here is still safe.
    const outcome = await drainNode({
      listener: async () => { if (server) await closeListener(server) },
      reconciliation: async () => { if (reconcileTask) await reconcileTask },
      schedules: async () => {
        schedulerCapability?.dispose()
        schedulerCapability = null
        await scheduler?.stop()
      },
      pluginState: async () => {
        pluginStateCapability?.dispose()
        pluginStateCapability = null
      },
      plugins: async () => await disposePlugins?.(),
      sqlite: async () => {
        if (dbClosed) return
        dbClosed = true
        db.close()
      },
      dataRoot: async () => dataRoot.release(),
    })
    if (outcome === 'timeout') console.warn('[service:stop] drain exceeded its deadline; exiting anyway')
    stateChanged('stopped')
    mark('teardown')
    // Whatever ACORN_PERF=1 collected, on the way out. A drain is the last chance to print it, and a
    // node that was killed rather than drained still has `kill -USR2` (node-core server/perf.ts).
    dumpPerf('drain')
  }

  try {
    // Audit retention and the idempotency sweep run as node-owned schedules, not boot-time calls
    // (docs/data-layer.md § Retention).
    mark('migrate')

    const worktreesDir = join(config.dataDir, 'worktrees')
    setWorktreesRoot(worktreesDir)
    // The four values a spawned child needs, and why each is a factory call rather than a record. See
    // docs/mcp.md § Launch environment and docs/authentication.md § Internal tokens. The signing key
    // persists across restarts so a tmux-reattached agent session keeps authenticating, and the port
    // is ephemeral so a baked URL would point at nothing.
    //
    // Seeding the token here and assigning `apiUrl` right after `startListener` binds is enough,
    // because every consumer calls this factory at spawn time rather than at wire time. The ordering
    // that matters is that these bridges are installed before any request can arrive.
    let apiUrl = ''
    const internalEnv: InternalEnvFactory = (claims) => ({
      ACORN_API_URL: apiUrl,
      ACORN_API_TOKEN: mintInternalToken(runtime.INTERNAL_TOKEN, claims),
      ACORN_DATA_DIR: config.dataDir,
      NODE_EXTRA_CA_CERTS: join(config.dataDir, 'tls', 'cert.pem'),
    })

    let finishReconcile!: () => void
    const reconciled = new Promise<void>((resolve) => (finishReconcile = resolve))

    // The plugin composition seam (docs/plugins.md § Collaboration rules). Owned by this runtime
    // rather than by the module, so a process that starts the service more than once (the tests do)
    // gets a clean graph each time instead of "capability already provided".
    const core = createCoreServices({ secrets: runtime.SECRETS, db, activeIdentity: runtime.ACTIVE_IDENTITY })
    // Awaited before the listener binds: a plugin's init opens and migrates its own SQLite file, so a
    // request must not be able to arrive first (server/pluginHost/host.ts).
    const graph = await assembleNodeGraph(config.dataDir, buildPluginDeps({ capabilities, core, internalEnv, reconciled }))
    // The node's one scheduler (docs/schedules.md § Why the node, and only the node): built and
    // provided before the plugins so a declared schedule has somewhere to land, started after the
    // listener binds because a catch-up run may call this node's own routes.
    scheduler = createScheduler(db, { env: runtime })
    schedulerCapability = capabilities.provide(SCHEDULER, scheduler)
    mark('graph')
    const plugins = await initPlugins(
      graph.plugins,
      // The persisted list unioned with the start config's (docs/node-distribution.md § Plugins): the
      // file is the only form a remote node has, and the start config stays a test/`dev:node`
      // override.
      { capabilities, core, env: runtime, dataDir: config.dataDir, disabled: disabled(), loaded: graph.loaded, mark },
    )
    disposePlugins = plugins.dispose
    if (plugins.skipped.length) console.log(`[service:boot] plugins disabled for this node: ${plugins.skipped.join(', ')}`)
    pluginStateCapability = capabilities.provide(
      PLUGIN_STATE,
      buildPluginStateBridge({
        dataDir: config.dataDir,
        db,
        roster: () => plugins.roster,
        booted: () => graph.installed.map((entry) => ({ id: entry.manifest.id, version: entry.manifest.version })),
        loadFailures: () => graph.failures,
        disabled,
        setDisabled: (names) => disabledPlugins.set(names),
        reloadHost: plugins,
      }),
    )

    wireAgentTools({ db })
    mark('install')

    const listener = await startListener(runtime, dataRoot, mark)
    server = listener.server
    endpoint = listener.endpoint
    identity = { fingerprint: listener.fingerprint, certPem: listener.certPem }
    apiUrl = endpoint.origin
    stateChanged('listening')
    mark('listener-up')
    await scheduler.start()
    mark('scheduler')

    stateChanged('reconciling')
    if (process.env.NODE_ENV !== 'test') {
      void refreshAcornMcpRegistrations().catch((error) => console.warn('[service:boot] MCP re-register failed:', error))
    }
    reconcileTask = (async () => {
      try {
        await reconcileNode({ db, dataDir: config.dataDir, capabilities, mark })
      } finally {
        finishReconcile()
        if (!stopped) stateChanged('ready')
      }
    })()

    return {
      // preview's one node-side read, resolved through its capability at call time rather than wired
      // as a query. `[]` when the plugin is disabled is the right answer, not a degradation: with no
      // preview plugin there are no page rules to report, and an empty list is already the "none
      // configured" case the browser automation handles.
      previewRules: async (taskId) => (await capabilities.get(PREVIEW_RULES)?.forTask(taskId)) ?? [],
      stop,
      started: {
        state: 'listening',
        nodeId: dataRoot.nodeId,
        endpoint,
        ...identity,
        // The local bundle pairs without a code: the client spawned this node, proof enough of owner
        // intent (docs/authentication.md § Pairing). The client passes back the token it remembered
        // from the OS keychain, and resolveDeviceToken reuses it while it still authenticates, so the
        // steady state is one device row per install rather than one per launch. The service never
        // persists it; custody stays with the client.
        deviceToken: await resolveDeviceToken(runtime.DEVICES, config.deviceToken, 'This computer'),
      },
    }
  } catch (error) {
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    await stop()
    throw error
  }
}
