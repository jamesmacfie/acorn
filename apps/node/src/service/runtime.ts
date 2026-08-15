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
import { pruneAudit } from '@acorn/node-core/server/audit.ts'
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

// Electron-free composition root. This process exclusively owns SQLite, Hono/WS, PTYs, workflow
// runners, child processes, caches, and reconciliation. Native UI operations are injected through
// DesktopCapabilities, so importing this module in a plain Node test never loads Electron.
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
  // Both hosts go through one reporter (server/composition.ts), so the account of what reconciliation
  // did — and of a package that has quietly stopped taking updates — cannot exist on one root only.
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
    // Bounded, and in this order — the same list, in the same order, as server/standalone.ts's:
    //   - the LISTENER first, so nothing new arrives while the rest tears down. This is also what stops
    //     the port outliving the drain, which is what made the two-node e2e reach for SIGKILL.
    //   - plugins before core's DB and before the root lock: each table-owning plugin has a WAL-mode
    //     SQLite file of its own (main/pluginStorage.ts), and the invariant below applies to those too.
    //     The plugin host closes each of them immediately after that plugin's dispose, inside this step
    //     (server/plugin/host.ts). This is also where the terminal engine's idle watch and session
    //     displays, the docker streams, the database plugin's pg pools and the agent runtime's live
    //     provider children / reconnect timers / webhook pump are closed — each in its own plugin's
    //     dispose, rather than in a list here that a new plugin has to remember to join.
    //   - the root lock LAST: only drop it once SQLite is closed, or a restart could open the database
    //     while this process still holds its WAL. A drain that hits the deadline leaves it to
    //     dataRoot's own `process.on('exit')` hook, which is why missing it here is survivable.
    const outcome = await drainNode({
      listener: async () => { if (server) await closeListener(server) },
      reconciliation: async () => { if (reconcileTask) await reconcileTask },
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
    // Expired replay rows read as absent already (auth/idempotency.ts), so this only reclaims space.
    // Boot is the right moment because it is the one time nothing is mid-request, and a periodic
    // sweeper would be machinery for a table that holds 24 hours of one owner's mutations.
    await runtime.IDEMPOTENCY.cleanupExpired()
    // Audit retention, for the same reason and at the same moment (docs/data-layer.md § Retention
    // defaults: 90 days). A timer for one range-delete a day would be machinery this does not need, and
    // a node nobody restarts is also one nobody is accumulating decisions on.
    await pruneAudit(runtime.DB).catch((error) => console.warn('[service:boot] audit prune failed:', error))
    mark('migrate')

    const worktreesDir = join(config.dataDir, 'worktrees')
    setWorktreesRoot(worktreesDir)
    // One factory, not one record. Every child gets a token minted for ITS scope — a PTY, an agent
    // session and a workflow step are all 'task'-scoped and bound to their own task, while the node's own
    // loopback calls are 'service' (server/auth/internalTokens.ts). Before this, all five presented the
    // same node-wide string, so the auth layer could not tell the service from a child an agent spawned.
    //
    // INTERNAL_TOKEN is now the signing KEY rather than the credential. It is still persisted across
    // boots, and for the same reason: an agent pane runs in tmux and is reattached after a restart,
    // keeping the environment of the boot that spawned it. A per-boot key would 404 every reattached
    // session's MCP / notes / memory / context calls.
    //
    // ACORN_API_URL is mutable on purpose — the listener's origin is not known until it binds, and every
    // consumer calls this factory at spawn time rather than at wire time (terminal.ts spreads it per
    // session; seedTaskNotes and the workflow runner read it per call). So seeding the token here and
    // assigning the URL right after startListener is enough; the wiring order exists for a different
    // reason, which is that bridges must be installed before requests arrive.
    //
    // ACORN_DATA_DIR is the stable thing a long-lived child needs. An agent pane runs in tmux and is
    // reattached after a restart with the environment of the boot that spawned it, and the port is
    // ephemeral now — so a baked URL points at nothing, and mcp/api.ts resolves the current one from
    // <dataDir>/node.json instead.
    //
    // NODE_EXTRA_CA_CERTS is how a child trusts the node's self-signed certificate with zero code. The
    // certificate is a CA with an IP:127.0.0.1 SAN (main/tls.ts), so the child validates FULLY — no
    // `rejectUnauthorized: false` anywhere. Ceiling documented in mcp/api.ts.
    let apiUrl = ''
    const internalEnv: InternalEnvFactory = (claims) => ({
      ACORN_API_URL: apiUrl,
      ACORN_API_TOKEN: mintInternalToken(runtime.INTERNAL_TOKEN, claims),
      ACORN_DATA_DIR: config.dataDir,
      NODE_EXTRA_CA_CERTS: join(config.dataDir, 'tls', 'cert.pem'),
    })

    let finishReconcile!: () => void
    const reconciled = new Promise<void>((resolve) => (finishReconcile = resolve))

    // The plugin composition seam (docs/plugins.md § Cross-plugin collaboration). Owned by this
    // runtime rather than by the module, so a process that starts the service more than once (the
    // tests do) gets a clean graph each time instead of "capability already provided".
    const core = createCoreServices({ secrets: runtime.SECRETS, db, activeIdentity: runtime.ACTIVE_IDENTITY, capabilities })
    // Awaited before the listener binds: a plugin's init opens and migrates its own SQLite file, so a
    // request must not be able to arrive first (server/plugin/host.ts).
    const graph = await assembleNodeGraph(config.dataDir, buildPluginDeps({ capabilities, core, internalEnv, reconciled, browser: desktop.browser }))
    const plugins = await initPlugins(
      graph.plugins,
      // The persisted per-node list UNION the start config's. The file is the owner's setting, and it is
      // the only form a remote node can have — nothing about a launchd boot consults a client's fleet
      // file. The start config stays an override for tests and `dev:node`, which want to pin a list
      // without writing into a data root.
      { capabilities, core, dataDir: config.dataDir, disabled: disabled(), loaded: graph.loaded },
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
        // A packaged app is not a development build. The standalone root has no such flag and reads
        // NODE_ENV instead; that is the one deliberate difference between the two.
        allowLocalPathInstalls: !config.isPackaged,
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
      // preview's one node-side read, resolved through its capability at CALL time rather than wired as a
      // query. `[]` when the plugin is disabled is the right answer, not a degradation: with no preview
      // plugin there are no page rules to report, and an empty list is already the "none configured" case
      // the browser automation handles.
      previewRules: async (taskId) => (await capabilities.get(PREVIEW_RULES)?.forTask(taskId)) ?? [],
      stop,
      started: {
        state: 'listening',
        nodeId: dataRoot.nodeId,
        endpoint,
        ...identity,
        // The local bundle pairs without a code: the client spawned this node, which is proof enough
        // of owner intent (docs/api-reference.md § Pairing, "Local bundle: no code"). The client
        // passes back the token it remembered from the OS keychain, and resolveDeviceToken reuses it
        // when it still authenticates, so the steady state is ONE device row rather than one per
        // launch. The service never persists it — custody belongs to the client.
        deviceToken: await resolveDeviceToken(runtime.DEVICES, config.deviceToken, 'This computer'),
      },
    }
  } catch (error) {
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    await stop()
    throw error
  }
}
