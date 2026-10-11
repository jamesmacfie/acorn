import { join } from 'node:path'
import type { NodeKeyCheck, NodeKeys } from '@acorn/protocol/serviceProtocol.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import { renewingInternalEnv } from '@acorn/node-core/server/auth'
import type { RuntimeBindings } from '@acorn/node-core/server/bindings.ts'
import { checkSessionKey, nodeKeyCustody } from '@acorn/node-core/server/bindings.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { PLUGIN_STATE } from '@acorn/node-core/server/pluginHost'
import { createCoreServices, type CompiledCoreServices } from '@acorn/node-core/server/core/index.ts'
import { beginLoginShellPath } from '@acorn/node-core/server/core'
import { disabledPluginsStore } from '@acorn/node-core/server/plugins'
import { closeListener, makeRuntime, startListener, type Listener } from '@acorn/node-core/server/transport/listener.ts'
import type { DataRoot } from '@acorn/node-core/server/storage'
import { setWorktreesRoot } from '@acorn/node-core/server/worktrees'
import { createScheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { configureAcornMcp, type Launcher } from '@acorn/node-core/server/mcpRegister.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools'
import { refreshAcornMcpRegistrations } from '@acorn/plugin-terminal/node/index.ts'
import { startTelemetry, stopTelemetry, TELEMETRY_PREF_KEY } from '@acorn/node-core/server/telemetry'
import { createLogger, describeError, installPerfSink } from '@acorn/node-core/server/telemetry'
import { setTelemetryDataRoot } from '@acorn/node-core/server/telemetry'
import { buildPluginDeps } from './pluginDeps'
import { buildPluginStateBridge, effectiveDisabled } from './pluginState'
import { assembleNodeGraph, drainNode, reconcileBundledPackages, reconcileNode, type NodeDrainResources } from './composition'

// What differs between the two hosts that boot a Node: the desktop helper's supervised Node
// (./runtime.ts) and the standalone Node (../entries/standalone.ts). Everything else is the same
// sequence, so it lives once, in bootNode below.
export type BootNodeOptions = {
  // Opened by the entry, because the standalone Node asks about its advertised host before it boots.
  // bootNode owns it from here and releases it on stop or on a failed boot.
  root: DataRoot
  // The desktop app's version. A standalone Node has none, so its telemetry release falls back to the
  // protocol version.
  appVersion?: string
  // Delivered in the desktop helper's start message. Without them the Node reads its keys from files in
  // the data root or from SESSION_ENC_KEY (docs/security/credentials.md § Node keys).
  keys?: NodeKeys
  // Set when the CLI runs this Node as a background service.
  serviceInstanceId?: string
  // The app's own read-only plugin packages. Absent on a service-managed standalone Node, which has
  // nothing to reconcile from (docs/node-distribution.md § Plugins).
  bundledPluginsDir?: string
  development: boolean
  // A start-config override unioned with the data root's own list. Only the supervised host passes one.
  disabledPlugins?: string[]
  // Probe a login shell for the owner's PATH. A packaged app starts with launchd's bare PATH. A Node
  // started from a shell already has the owner's.
  loginShellPath: boolean
  // The MCP server this Node offers agents. Only the supervised host knows where the staged mcp.js is.
  // A standalone Node passes none: re-registering at boot would point the person's `acorn` entry at a
  // guessed path (docs/mcp.md § Configuration).
  mcp?: { name: string; launcher: Launcher }
}

export type BootedNode = {
  runtime: RuntimeBindings
  core: CompiledCoreServices
  listener: Listener
  keyCheck: NodeKeyCheck
  // Settles once the post-listener reconcile has run. Never rejects. The supervised host reports
  // `ready` after it, and the standalone host waits for it before it prints its handshake.
  reconciled: Promise<void>
  // The bounded drain (docs/node-distribution.md § Operations). Safe to call more than once: every
  // call waits on the same drain.
  stop(): Promise<void>
}

// Two tags rather than one, so the lines keep the `[service:boot]` and `[service:stop]` prefixes a
// person greps for and docs/local-development/profiling.md § Timing a cold start names.
const bootLog = createLogger('service:boot')
const stopLog = createLogger('service:stop')

// The node's cold-start account, one line per step, and unconditional: a node that took eleven seconds
// to bind should say so without anyone having asked for it. Per-request timing is the opposite and sits
// behind ACORN_PERF=1 (node-core server/telemetry/collector.ts).
//
// On stderr, like every other line the node writes. Stdout is a wire in the standalone entry and in
// the helper, and the desktop boot test reads the helper's `[helper:boot]` lines rather than these.
//
// Two numbers per line, because both questions get asked. `+Nms` is the offset from the first line, so
// a person can read the shape of a boot down the column; `(Nms)` is this step alone, so the one step
// that cost the boot is the one wide number. The plugin passes are named per plugin because `install`
// alone cannot say which plugin was the slow one. Those lines are wall-clock slices rather than
// per-plugin costs, because the passes overlap: a plugin's line says when it finished
// (docs/local-development/profiling.md § Timing a cold start).
function bootTimer(): (label: string) => void {
  const started = process.hrtime.bigint()
  let previous = started
  return (label) => {
    const now = process.hrtime.bigint()
    const ms = (from: bigint) => (Number(now - from) / 1e6).toFixed(0)
    bootLog.info(`${label} +${ms(started)}ms (${ms(previous)}ms)`)
    previous = now
  }
}

// The one boot sequence both Node hosts run (docs/node-distribution.md § Runtime). It takes no native
// surface, so importing this module in a plain Node test loads no shell. Each host adds only its own
// work around it: state reporting and preview rules for the supervised Node, enrollment, the pairing
// banner, the handshake, and signals for the standalone one.
export async function bootNode(options: BootNodeOptions): Promise<BootedNode> {
  const { root } = options
  const dataDir = root.dir
  const mark = bootTimer()
  // Started, not awaited. On a packaged macOS build this spawns a login shell to recover the owner's
  // PATH, which takes half a second to two seconds on a profile with a version manager in it. The
  // PATH is for spawning agents and build commands later, so the first spawn waits on it instead of
  // the whole boot (node-core server/core/loginShellPath.ts, docs/node-distribution.md § Boot order).
  beginLoginShellPath(options.loginShellPath)
  mark('login-shell')
  if (options.mcp) configureAcornMcp(options.mcp.name, options.mcp.launcher)

  // Each step starts as a no-op and is replaced once the boot builds what it closes, so a boot that
  // fails partway drains exactly what it built. The listener closes first, so nothing new arrives
  // while the rest tears down.
  //
  // Each table-owning plugin's WAL-mode SQLite file closes inside that plugin's own dispose
  // (server/pluginHost/host.ts), along with everything else that plugin owns, so this list never has to
  // grow when a new plugin needs teardown.
  //
  // The root lock releases last, once SQLite is closed, or a restart could open the database while
  // this process still holds its WAL. A drain that hits the deadline leaves the lock to dataRoot's
  // own `process.on('exit')` hook, which is why missing it here is still safe.
  const drain: NodeDrainResources = {
    listener: async () => {},
    reconciliation: async () => {},
    schedules: async () => {},
    pluginState: async () => {},
    plugins: async () => {},
    sqlite: async () => {},
    dataRoot: async () => root.release(),
  }
  let stopping: Promise<void> | null = null
  const stop = (): Promise<void> => (stopping ??= (async () => {
    const outcome = await drainNode(drain)
    if (outcome === 'timeout') stopLog.warn('drain exceeded its deadline; exiting anyway')
    mark('teardown')
    // The last chance a sink gets, and where `ACORN_PERF=1` prints its histograms. A node that was
    // killed rather than drained still has `kill -USR2` (node-core server/telemetry/collector.ts).
    stopTelemetry()
  })())

  try {
    // One reporter for both hosts (docs/node-distribution.md § Plugins), before the loader scans the
    // install directory.
    reconcileBundledPackages({ dataDir, bundledRoot: options.bundledPluginsDir, development: options.development })
    mark('bundled-packages')
    const capabilities = new CapabilityRegistry()
    const runtime = makeRuntime(root, options.appVersion, capabilities, options.serviceInstanceId, options.keys)
    const db = runtime.DB
    drain.sqlite = async () => db.close()
    // Audit retention and the idempotency sweep run as node-owned schedules, not boot-time calls
    // (docs/data-layer/backup-and-retention.md § Retention).
    mark('migrate')
    // Read before the plugin host runs and before any route can answer, which is why it is a file in the
    // data root rather than a settings row: the list decides which databases get opened at all.
    const disabledPlugins = disabledPluginsStore(dataDir)
    const disabled = effectiveDisabled(disabledPlugins, options.disabledPlugins)
    setWorktreesRoot(join(dataDir, 'worktrees'))

    // The four values a spawned child needs, and why each is a factory call rather than a record. See
    // docs/mcp.md § Launch environment and docs/authentication.md § Internal tokens. The signing key
    // persists across restarts; a session's file receives a fresh token at boot and on the refresh
    // timer. The port is ephemeral, so a baked URL would point at nothing.
    //
    // The factory mints on demand and `apiUrl` is assigned after binding. The ordering that matters
    // is that these bridges are installed before any request can arrive.
    let apiUrl = ''
    const credentials = renewingInternalEnv(runtime.INTERNAL_TOKEN, dataDir, () => ({
      ACORN_API_URL: apiUrl,
      ACORN_NODE_ID: runtime.NODE_ID,
      ACORN_DATA_DIR: dataDir,
      NODE_EXTRA_CA_CERTS: join(dataDir, 'tls', 'cert.pem'),
    }), runtime.INTERNAL_CREDENTIALS)
    drain.dataRoot = async () => { credentials.dispose(); root.release() }
    // Whether the session key opens a stored credential. The helper keeps the plain session.key unless
    // it does (docs/security/credentials.md § Node keys). A standalone Node asks the same question of
    // the key it read from a file or its environment.
    const keyCheck = await checkSessionKey(db, runtime.SECRETS)
    mark('key-check')

    let finishReconcile!: () => void
    const reconciled = new Promise<void>((resolve) => (finishReconcile = resolve))

    // The plugin composition seam (docs/plugins/collaboration.md § Collaboration rules). Owned by this
    // boot rather than by the module, so a process that boots more than once (the tests do) gets a
    // clean graph each time instead of "capability already provided".
    const core = createCoreServices({ secrets: runtime.SECRETS, db, activeIdentity: runtime.ACTIVE_IDENTITY })
    // Open task script waits are aborted, and a pending setup attempt is recorded as interrupted by
    // `shutdown` rather than by `restart` on the next boot.
    drain.listener = async () => core.taskScripts.close()
    // Before the plugins, so one that declares the `telemetry` token can subscribe from its own
    // `init` and see the boot it was loaded during. The preference is read on the collector's own
    // timer rather than here: `PUT /v1/core/prefs` writes the table directly and cannot notify, so a
    // switch flipped in Settings is seen within five seconds (docs/telemetry/model.md § The switch).
    setTelemetryDataRoot(dataDir)
    startTelemetry({
      node: root.nodeId,
      version: options.appVersion ?? NODE_PROTOCOL_VERSION.toString(),
      readPref: async () => {
        const userId = runtime.ACTIVE_IDENTITY.get()
        return userId ? await core.prefs.read(userId, TELEMETRY_PREF_KEY) : null
      },
    })
    installPerfSink()
    // Awaited before the listener binds: a plugin's init opens and migrates its own SQLite file, so a
    // request must not be able to arrive first (server/pluginHost/host.ts).
    const graph = await assembleNodeGraph(dataDir, buildPluginDeps({ capabilities, internalEnv: credentials.internalEnv, reconciled }))
    // The node's one scheduler (docs/schedules.md § Why the node, and only the node): built and
    // provided before the plugins so a declared schedule has somewhere to land, started after the
    // listener binds because a catch-up run may call this node's own routes.
    const scheduler = createScheduler(db, { env: runtime })
    const providedScheduler = capabilities.provide(SCHEDULER, scheduler)
    drain.schedules = async () => { providedScheduler.dispose(); await scheduler.stop() }
    mark('graph')
    const plugins = await initPlugins(
      graph.plugins,
      { capabilities, core, env: runtime, dataDir, disabled: disabled(), loaded: graph.loaded, mark },
    )
    drain.plugins = () => plugins.dispose()
    if (plugins.skipped.length) bootLog.info(`plugins disabled for this node: ${plugins.skipped.join(', ')}`)
    const pluginStateBridge = await buildPluginStateBridge({
      dataDir,
      db,
      roster: () => plugins.roster,
      booted: () => graph.installed,
      loadFailures: () => graph.failures,
      disabled,
      setDisabled: (names) => disabledPlugins.set(names),
      reloadHost: plugins,
    })
    const providedPluginState = capabilities.provide(PLUGIN_STATE, pluginStateBridge)
    drain.pluginState = async () => { providedPluginState.dispose(); pluginStateBridge.dispose() }
    core.nodeKeys = nodeKeyCustody(dataDir, options.keys ? 'desktop' : 'files', keyCheck)
    core.pluginSecurity = { snapshot: async () => (await import('@acorn/node-core/server/pluginHost/pluginSecurity.ts')).pluginSecuritySnapshot(pluginStateBridge) }

    // Core's own agent tools and the config-trust bridge. Both are pure functions over the database.
    wireAgentTools({ db, secrets: runtime.SECRETS, env: runtime })
    mark('install')

    const listener = await startListener(runtime, root, mark)
    drain.listener = async () => { core.taskScripts.close(); await closeListener(listener.server) }
    apiUrl = listener.endpoint.origin
    mark('listener-up')
    await scheduler.start()
    mark('scheduler')

    if (options.mcp && process.env.NODE_ENV !== 'test') {
      void refreshAcornMcpRegistrations().catch((error) => bootLog.warn(`MCP re-register failed: ${describeError(error).message}`))
    }
    // Re-attach sessions, repair worktree state, and sweep workflow and agent records. The listener is
    // already live because resumed work calls the node's own authenticated routes.
    const reconcileTask = reconcileNode({ db, dataDir, capabilities, mark }).finally(() => {
      core.taskScripts.reconcile()
      finishReconcile()
    })
    drain.reconciliation = () => reconcileTask

    return { runtime, core, listener, keyCheck, reconciled, stop }
  } catch (error) {
    await stop()
    throw error
  }
}
