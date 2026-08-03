import type { ServerType } from '@hono/node-server'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import '../server/providers'
import '../server/routes'
import '../wiring/agentProfiles'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import type { ServiceEndpoint, ServiceStartConfig, ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { openDataRoot, type DataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { launcherSpec, serverName } from '@acorn/node-core/main/mcpRegister.ts'
import { reconcileWorktrees, setWorktreesRoot } from '@acorn/node-core/main/taskWorktree.ts'
import { logStorageFootprint } from '@acorn/node-core/main/storageFootprint.ts'
import { disposeWsHub } from '@acorn/node-core/main/wsHub.ts'
import { wireManagedAgents } from '../wiring/managedAgentsWiring'
import { wireServerBridges } from '../wiring/serverBridges'
import { wireRunBridge } from '../wiring/harnessWiring'
import { wireAgentTools } from '../wiring/agentToolsWiring'
import { wireContextSections } from '../wiring/contextSectionsWiring'
import { registerWorkflowIpc } from '../wiring/workflowWiring'
import { wireConfigTrust } from '../wiring/configTrustWiring'
import { prepareSecurityState } from '../wiring/startupSecurity'
import { registerKnowledgeIpc } from '@acorn/plugin-memory/main/knowledgeIpc.ts'
import { createRuntimeService } from '@acorn/plugin-terminal/main/runIpc.ts'
import {
  configureTerminalMcp,
  disposeTerminal,
  reconcileTmux,
  refreshAcornMcpRegistrations,
  registerTerminalIpc,
  sendToAgent,
  terminalRunGlue,
} from '@acorn/plugin-terminal/main/terminal.ts'
import { endDbPools } from '@acorn/plugin-database/main/database.ts'
import { disposeDocker } from '@acorn/plugin-docker/main/dockerService.ts'
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
  let managedAgents: ReturnType<typeof wireManagedAgents> | null = null
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
      await managedAgents?.stop()
    } catch (error) {
      console.warn('[service:stop] managed agents close failed:', error)
    }
    try {
      await reconcileTask
    } catch (error) {
      console.warn('[service:stop] reconciliation drain failed:', error)
    }
    try {
      disposeTerminal()
    } catch (error) {
      console.warn('[service:stop] terminal close failed:', error)
    }
    try {
      disposeDocker()
    } catch (error) {
      console.warn('[service:stop] docker close failed:', error)
    }
    try {
      await endDbPools()
    } catch (error) {
      console.warn('[service:stop] database pools close failed:', error)
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
    await prepareSecurityState(runtime)
    // Expired replay rows read as absent already (auth/idempotency.ts), so this only reclaims space.
    // Boot is the right moment because it is the one time nothing is mid-request, and a periodic
    // sweeper would be machinery for a table that holds 24 hours of one owner's mutations.
    await runtime.IDEMPOTENCY.cleanupExpired()
    mark('migrate')

    const worktreesDir = join(config.dataDir, 'worktrees')
    setWorktreesRoot(worktreesDir)
    // Mutable on purpose. The listener's origin is not known until it binds, but every consumer of
    // this object reads it at spawn/call time rather than at wire time (terminal.ts spreads it per
    // session, seedTaskNotes and workflowWiring read it per call), so seeding the token here and
    // assigning the URL right after startListener is enough — no restructuring of the wiring order,
    // which exists for a different reason (bridges must be installed before requests arrive).
    //
    // Two of these four are split by LIFETIME, not by taste. ACORN_API_URL is correct for callers
    // rebuilt on every boot (seedTaskNotes, workflowWiring, both in-process). It is NOT correct for a
    // child that outlives a boot: an agent pane runs in tmux and is reattached after a restart, keeping
    // the environment of the boot that created it — and the port is ephemeral now, so a baked URL points
    // at nothing. ACORN_DATA_DIR is the stable thing, and mcp/api.ts resolves the current port from
    // <dataDir>/node.json. The internal token needs no such treatment: it is deliberately persisted
    // across boots for exactly this reason (main/bindings.ts).
    //
    // NODE_EXTRA_CA_CERTS is how a child trusts the node's self-signed certificate with zero code. The
    // certificate is a CA with an IP:127.0.0.1 SAN (main/tls.ts), so the child validates FULLY — no
    // `rejectUnauthorized: false` anywhere. Ceiling documented in mcp/api.ts.
    const internalApiEnv = {
      ACORN_API_URL: '',
      ACORN_API_TOKEN: runtime.INTERNAL_TOKEN,
      ACORN_DATA_DIR: config.dataDir,
      NODE_EXTRA_CA_CERTS: join(config.dataDir, 'tls', 'cert.pem'),
    }

    let finishReconcile!: () => void
    const reconciled = new Promise<void>((resolve) => (finishReconcile = resolve))

    // The plugin composition seam (docs/vNext/plugins.md § Cross-plugin collaboration). Owned by this
    // runtime rather than by the module, so a process that starts the service more than once (the
    // tests do) gets a clean graph each time instead of "capability already provided".
    const capabilities = new CapabilityRegistry()

    const knowledge = registerKnowledgeIpc(db, config.dataDir, {
      sendToAgent,
      currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
    })
    wireConfigTrust(db)
    const runtimeService = createRuntimeService(db, terminalRunGlue(db))
    wireRunBridge(runtimeService)
    wireContextSections({ db, notesStore: knowledge.notesStore, reconciled: knowledge.reconciled })
    wireAgentTools({
      db,
      notesStore: knowledge.notesStore,
      proposals: knowledge.proposals,
      runtime: runtimeService,
      reconciled: knowledge.reconciled,
      browser: desktop.browser,
    })
    managedAgents = wireManagedAgents({
      db,
      dataDir: config.dataDir,
      internalApiEnv,
      encryptionKey: runtime.SESSION_ENC_KEY,
      capabilities,
      currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
      memoryReviewTrigger: knowledge.memoryReviewTrigger,
    })
    const workflowRunner = await registerWorkflowIpc(db, {
      capabilities,
      runtime: runtimeService,
      notesStore: knowledge.notesStore,
      internalApiEnv,
      reconciled,
      currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
      memoryReviewTrigger: knowledge.memoryReviewTrigger,
    })
    wireServerBridges(db, config.dataDir)
    registerTerminalIpc(db, worktreesDir, {
      internalApiEnv,
      launchInjector: knowledge.launchInjector,
      memoryReviewTrigger: knowledge.memoryReviewTrigger,
      seedTaskNotes: (task) => seedTaskNotes(db, knowledge.notesStore, internalApiEnv, task),
      reconciled,
    })
    mark('install')

    const listener = await startListener(runtime, dataRoot)
    server = listener.server
    endpoint = listener.endpoint
    identity = { fingerprint: listener.fingerprint, certPem: listener.certPem }
    internalApiEnv.ACORN_API_URL = endpoint.origin
    stateChanged('listening')
    mark('listener-up')

    stateChanged('reconciling')
    if (process.env.NODE_ENV !== 'test') {
      void refreshAcornMcpRegistrations().catch((error) => console.warn('[service:boot] MCP re-register failed:', error))
    }
    reconcileTask = (async () => {
      void logStorageFootprint(db, config.dataDir).catch((error) => console.warn('[storage] footprint failed:', error))
      try {
        await reconcileTmux(db)
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
        await workflowRunner.reconcile()
        mark('reconcile.workflow')
      } catch (error) {
        console.warn('[service:boot] reconcile workflow failed:', error)
      }
      try {
        await managedAgents?.reconcile()
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
