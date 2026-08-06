import type { ServerType } from '@hono/node-server'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import '../server/providers'
import '../server/routes'
import '../wiring/agentProfiles'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import type { ServiceEndpoint, ServiceStartConfig, ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { mintInternalToken, type InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { nodePlugins } from '../server/plugins'
import { makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { openDataRoot, type DataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { launcherSpec, serverName } from '@acorn/node-core/main/mcpRegister.ts'
import { reconcileWorktrees, setWorktreesRoot } from '@acorn/node-core/main/taskWorktree.ts'
import { logStorageFootprint } from '@acorn/node-core/main/storageFootprint.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { disposeWsHub } from '@acorn/node-core/main/wsHub.ts'
import { wireAgentTools } from '../wiring/agentToolsWiring'
import { wireContextSections } from '../wiring/contextSectionsWiring'
import { wireConfigTrust } from '../wiring/configTrustWiring'
import { AGENTS_RUNTIME } from '@acorn/plugin-agents/main/runtime.ts'
import { MEMORY_KNOWLEDGE } from '@acorn/plugin-memory/main/knowledgeIpc.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { WORKFLOWS_RUNNER } from '@acorn/plugin-workflows/main/workflowRunner.ts'
import { configureTerminalMcp, reconcileTmux, refreshAcornMcpRegistrations } from '@acorn/plugin-terminal/main/terminal.ts'
import { seedTaskNotes } from '@acorn/plugin-notes/main/seedTaskNotes.ts'
import { previewRulesForTask } from '@acorn/plugin-preview/server/previewRules.ts'

export type ServiceRuntime = {
  previewRules(taskId: string): ReturnType<typeof previewRulesForTask>
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

function closeListener(server: ServerType | null): Promise<void> {
  if (!server) return Promise.resolve()
  const httpServer = server as unknown as import('node:http').Server
  disposeWsHub(httpServer)
  return new Promise((resolve) => {
    server.close(() => resolve())
    // Node otherwise waits out keepAliveTimeout for an idle renderer/fetch socket. Once close()
    // has stopped new requests, loopback connections are safe to reap immediately; WebSockets were
    // already terminated by disposeWsHub above.
    httpServer.closeIdleConnections?.()
    httpServer.closeAllConnections?.()
  })
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
  try {
    runtime = makeRuntime(dataRoot, config.version)
  } catch (error) {
    dataRoot.release()
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    throw error
  }
  const db = runtime.DB

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    stateChanged('draining')
    try {
      await closeListener(server)
    } catch (error) {
      console.warn('[service:stop] listener close failed:', error)
    }
    try {
      await reconcileTask
    } catch (error) {
      console.warn('[service:stop] reconciliation drain failed:', error)
    }
    // Before core's DB and before the root lock: each plugin owns a WAL-mode SQLite file of its own
    // (main/pluginStorage.ts), and the invariant below applies to those too. This is also where the
    // terminal engine's idle watch and session displays, the docker streams, the database plugin's pg
    // pools and the agent runtime's live provider children / reconnect timers / webhook pump are closed
    // — each in its own plugin's dispose, rather than in a list here that a new plugin has to remember
    // to join.
    try {
      await disposePlugins?.()
    } catch (error) {
      console.warn('[service:stop] plugin dispose failed:', error)
    }
    if (!dbClosed) {
      dbClosed = true
      try {
        db.close()
      } catch (error) {
        console.warn('[service:stop] SQLite close failed:', error)
      }
    }
    // Last: only drop the root lock once SQLite is closed, or a restart could open the database
    // while this process still holds its WAL.
    try {
      dataRoot.release()
    } catch (error) {
      console.warn('[service:stop] data root release failed:', error)
    }
    stateChanged('stopped')
    mark('teardown')
  }

  try {
    // Expired replay rows read as absent already (auth/idempotency.ts), so this only reclaims space.
    // Boot is the right moment because it is the one time nothing is mid-request, and a periodic
    // sweeper would be machinery for a table that holds 24 hours of one owner's mutations.
    await runtime.IDEMPOTENCY.cleanupExpired()
    mark('migrate')

    const worktreesDir = join(config.dataDir, 'worktrees')
    setWorktreesRoot(worktreesDir)
    // Mutable on purpose. The listener's origin is not known until it binds, but every consumer of
    // this object reads it at spawn/call time rather than at wire time (terminal.ts spreads it per
    // session, seedTaskNotes and the workflow runner read it per call), so seeding the token here and
    // assigning the URL right after startListener is enough — no restructuring of the wiring order,
    // which exists for a different reason (bridges must be installed before requests arrive).
    //
    // Two of these four are split by LIFETIME, not by taste. ACORN_API_URL is correct for callers
    // rebuilt on every boot (seedTaskNotes and the workflow runner, both in-process). It is NOT correct for a
    // child that outlives a boot: an agent pane runs in tmux and is reattached after a restart, keeping
    // the environment of the boot that created it — and the port is ephemeral now, so a baked URL points
    // at nothing. ACORN_DATA_DIR is the stable thing, and mcp/api.ts resolves the current port from
    // <dataDir>/node.json. The internal token needs no such treatment: it is deliberately persisted
    // across boots for exactly this reason (main/bindings.ts).
    //
    // NODE_EXTRA_CA_CERTS is how a child trusts the node's self-signed certificate with zero code. The
    // certificate is a CA with an IP:127.0.0.1 SAN (main/tls.ts), so the child validates FULLY — no
    // `rejectUnauthorized: false` anywhere. Ceiling documented in mcp/api.ts.
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
    // consumer calls this factory at spawn time rather than at wire time. ACORN_DATA_DIR is the stable
    // thing a long-lived child needs: mcp/api.ts resolves the current port from <dataDir>/node.json,
    // because the port is ephemeral now and a baked URL would point at nothing after a restart.
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

    // The plugin composition seam (docs/vNext/plugins.md § Cross-plugin collaboration). Owned by this
    // runtime rather than by the module, so a process that starts the service more than once (the
    // tests do) gets a clean graph each time instead of "capability already provided".
    const capabilities = new CapabilityRegistry()
    const core = createCoreServices({ secrets: runtime.SECRETS, db })
    // The memory runtime, resolved LAZILY. plugins/terminal needs three of its closures (the launch
    // injector, the memory-review trigger and note seeding) at spawn time, but it may not import them:
    // `memory.knowledge`'s id lives in that plugin's main/ rather than a contract/, so the edge would be
    // a plugin→plugin coupling. So the composition root resolves the capability on terminal's behalf, at
    // CALL time — which is also the only order that can work, since terminal's init runs inside
    // initPlugins and memory's may not have run yet when the deps below are constructed.
    const knowledgeAt = () => capabilities.require(MEMORY_KNOWLEDGE)
    // plugins/notes' store, resolved the same way and for the same reason. It used to be reached as
    // `knowledgeAt().notesStore`, because plugins/memory constructed it; notes owns it now and publishes
    // it as `notes.store` from its contract/ (plugins/notes/src/contract/store.ts).
    const notesAt = () => capabilities.require(NOTES_STORE)
    // Awaited before the listener binds: a plugin's init opens and migrates its own SQLite file, so a
    // request must not be able to arrive first (server/plugin/host.ts).
    const plugins = await initPlugins(
      nodePlugins(config.dataDir, {
        agents: {
          internalEnv,
          currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
          memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
        },
        memory: { currentUserId: () => runtime.ACTIVE_IDENTITY.get() },
        terminal: {
          internalEnv,
          launchInjector: (taskId, sessionId) => knowledgeAt().launchInjector(taskId, sessionId),
          memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
          // 'service' scope, deliberately: seeding calls the node's own loopback surface to read the PR
          // mirror and the linked Linear tickets, so it must keep the reach a task-scoped child is denied.
          seedTaskNotes: (task) => seedTaskNotes(core, notesAt(), internalEnv({ scope: 'service' }), task),
          reconciled,
        },
        workflows: {
          internalEnv,
          reconciled,
          currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
          memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
          // github's `repos` + `checks`, now behind that plugin's own capability. Resolved at CALL
          // time, never at init: plugin init order is undefined, so reading it here could capture
          // `undefined` purely because github is declared after workflows in the list. `get`, not
          // `require` — a node whose github init failed should fail this one policy, not every step.
          failingChecks: async (taskId) =>
            (await capabilities.get(GITHUB_MIRROR)?.failingChecks(runtime.ACTIVE_IDENTITY.get(), taskId)) ?? null,
        },
      }),
      { capabilities, core },
    )
    disposePlugins = plugins.dispose
    if (plugins.skipped.length) console.log(`[service:boot] plugins disabled for this node: ${plugins.skipped.join(', ')}`)

    // Published by a plugin's init rather than constructed here. `require`, not `get`: memory and notes
    // are `required` plugins, so absence is a bug rather than a configuration.
    const knowledge = knowledgeAt()
    wireConfigTrust(db)
    wireContextSections({ db, notesStore: notesAt(), memory: knowledge, mirror: () => capabilities.get(GITHUB_MIRROR) })
    // Only the tools no plugin can own yet: core's task/PR reads and the browser (plugins/preview runs in
    // Electron main). changes, memory, notes, terminal and workflows register their own inside initPlugins
    // above — which is why this bag no longer holds the memory index, the proposal store, the run service
    // or the notes store.
    wireAgentTools({ db, browser: desktop.browser })
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
      // The github mirror's row counts come from the plugin that owns those tables now; core counts only
      // what it can still see (main/storageFootprint.ts explains why an absent contributor is omitted
      // from the line rather than logged as zero).
      const githubMirror = capabilities.get(GITHUB_MIRROR)
      void logStorageFootprint(
        db,
        config.dataDir,
        githubMirror ? [{ plugin: 'github', counts: () => githubMirror.footprint() }] : [],
      ).catch((error) => console.warn('[storage] footprint failed:', error))
      try {
        await reconcileTmux()
        mark('reconcile.tmux')
      } catch (error) {
        console.warn('[service:boot] reconcile tmux failed:', error)
      }
      try {
        await reconcileWorktrees(db)
        mark('reconcile.worktrees')
      } catch (error) {
        console.warn('[service:boot] reconcile worktrees failed:', error)
      }
      try {
        // The workflows plugin builds the runner; the ordering stays the composition root's. It must run
        // after the listener binds (a resumed step calls the node's own loopback context route) and before
        // finishReconcile() below, because start/gate/cancel all await that promise so a run cannot be
        // started into the sweep. `get`, not `require`: workflows is not a required plugin.
        await capabilities.get(WORKFLOWS_RUNNER)?.reconcile()
        mark('reconcile.workflow')
      } catch (error) {
        console.warn('[service:boot] reconcile workflow failed:', error)
      }
      try {
        // Same shape as the workflow sweep above and for the same reason: the plugin builds the runtime,
        // the ordering stays here. It has to run after the listener binds (a resumed session's tools call
        // the node's own loopback surface) and before finishReconcile(). `require`, not `get`: agents is
        // a required plugin.
        await capabilities.require(AGENTS_RUNTIME).reconcile()
        mark('reconcile.agents')
      } catch (error) {
        console.warn('[service:boot] reconcile managed agents failed:', error)
      }
      finishReconcile()
      if (!stopped) stateChanged('ready')
    })()

    return {
      previewRules: (taskId) => previewRulesForTask(db, taskId),
      stop,
      started: {
        state: 'listening',
        nodeId: dataRoot.nodeId,
        endpoint,
        ...identity,
        // The local bundle pairs without a code: the client spawned this node, which is proof enough
        // of owner intent (docs/vNext/protocol.md § Pairing, "Local bundle: no code"). The client
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
