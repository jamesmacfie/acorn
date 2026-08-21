import type { ServerType } from '@hono/node-server'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import type { ServiceEndpoint, ServiceStartConfig, ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { mintInternalToken, type InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { disabledPluginsStore } from '@acorn/node-core/main/disabledPlugins.ts'
import { PLUGIN_STATE } from '@acorn/node-core/server/plugin/pluginState.ts'
import { buildPluginDeps } from '../server/pluginDeps'
import { buildPluginStateBridge, effectiveDisabled } from '../server/pluginState'
import { closeListener, makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { openDataRoot, type DataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { setWorktreesRoot } from '@acorn/node-core/main/taskWorktree.ts'
import { createScheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { launcherSpec, serverName } from '@acorn/node-core/main/mcpRegister.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { configureTerminalMcp, refreshAcornMcpRegistrations } from '@acorn/plugin-terminal/main/index.ts'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import { PREVIEW_RULES } from '@acorn/plugin-preview/contract/rules.ts'
import { assembleNodeGraph, drainNode, reconcileBundledPackages, reconcileNode } from '../server/composition'

export type ServiceRuntime = {
  previewRules(taskId: string): Promise<PreviewBrowserRule[]>
  stop(): Promise<void>
  // What the parent needs to reach this node: where it bound, who it is, and the bearer to use.
  // Reported rather than assumed, so a second node on the same machine is just another endpoint.
  started: ServiceStartResult
}

type RuntimeOptions = {
  config: ServiceStartConfig
  desktop: DesktopCapabilities
  stateChanged(state: ServiceState, detail?: string): void
}

function bootTimer(): (label: string) => void {
  const started = process.hrtime.bigint()
  return (label) => console.log(`[service:boot] ${label} +${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(0)}ms`)
}

async function inheritLoginShellPath(isPackaged: boolean): Promise<void> {
  if (process.platform !== 'darwin' || !isPackaged) return
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const path = await new Promise<string>((resolve, reject) => {
      execFile(shell, ['-lic', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 5_000 }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout.trim())
      })
    })
    if (path) process.env.PATH = path
  } catch (error) {
    console.warn('[service:boot] login-shell PATH probe failed; keeping inherited PATH:', error)
  }
}

// Electron-free composition root (docs/architecture-overview.md § Process ownership). Importing
// this module in a plain Node test never loads Electron: native UI operations arrive through
// DesktopCapabilities.
export async function startServiceRuntime({ config, desktop, stateChanged }: RuntimeOptions): Promise<ServiceRuntime> {
  const mark = bootTimer()
  await inheritLoginShellPath(config.isPackaged)
  configureTerminalMcp(
    serverName(config.isPackaged),
    launcherSpec(config.electronPath, config.mcpEntry, serverName(config.isPackaged)),
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
    // Same bounded order as server/standalone.ts (docs/node-distribution.md § Operations): the
    // listener closes first, so nothing new arrives while the rest tears down.
    //
    // Each table-owning plugin's WAL-mode SQLite file closes inside that plugin's own dispose
    // (server/plugin/host.ts). That is also where the terminal engine's idle watch and session
    // displays, the docker streams, the database plugin's pg pools, and the agent runtime's live
    // provider children, reconnect timers and webhook pump all close, so this list never has to grow
    // when a new plugin needs its own teardown.
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
  }

  try {
    // Audit retention and the idempotency sweep run as node-owned schedules now, not boot-time calls
    // (docs/data-layer.md § Retention).
    mark('migrate')

    const worktreesDir = join(config.dataDir, 'worktrees')
    setWorktreesRoot(worktreesDir)
    // The four values a spawned child needs, and why each is a factory call rather than a record
    // (docs/mcp.md § Launch environment; docs/authentication.md § Internal tokens): the signing key
    // persists across restarts so a tmux-reattached agent session keeps authenticating, and the port
    // is ephemeral so a baked URL would point at nothing.
    //
    // Seeding the token here and assigning `apiUrl` right after `startListener` binds is enough,
    // because every consumer calls this factory at spawn time rather than at wire time. The ordering
    // that actually matters is that these bridges are installed before any request can arrive.
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
    const core = createCoreServices({ secrets: runtime.SECRETS, db, activeIdentity: runtime.ACTIVE_IDENTITY, capabilities })
    // Awaited before the listener binds: a plugin's init opens and migrates its own SQLite file, so a
    // request must not be able to arrive first (server/plugin/host.ts).
    const graph = await assembleNodeGraph(config.dataDir, buildPluginDeps({ capabilities, core, internalEnv, reconciled, browser: desktop.browser }))
    // The node's one scheduler (docs/schedules.md § Why the node, and only the node): built and
    // provided before the plugins so a declared schedule has somewhere to land, started after the
    // listener binds because a catch-up run may call this node's own routes.
    scheduler = createScheduler(db, { env: runtime })
    schedulerCapability = capabilities.provide(SCHEDULER, scheduler)
    const plugins = await initPlugins(
      graph.plugins,
      // The persisted list unioned with the start config's (docs/node-distribution.md § Plugins): the
      // file is the only form a remote node has, and the start config stays a test/`dev:node`
      // override.
      { capabilities, core, env: runtime, dataDir: config.dataDir, disabled: disabled(), loaded: graph.loaded },
    )
    disposePlugins = plugins.dispose
    if (plugins.skipped.length) console.log(`[service:boot] plugins disabled for this node: ${plugins.skipped.join(', ')}`)
    pluginStateCapability = capabilities.provide(
      PLUGIN_STATE,
      buildPluginStateBridge({
        dataDir: config.dataDir,
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

    const listener = await startListener(runtime, dataRoot)
    server = listener.server
    endpoint = listener.endpoint
    identity = { fingerprint: listener.fingerprint, certPem: listener.certPem }
    apiUrl = endpoint.origin
    stateChanged('listening')
    await scheduler.start()
    mark('listener-up')

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
