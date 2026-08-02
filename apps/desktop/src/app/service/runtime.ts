import type { ServerType } from '@hono/node-server'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import '../server/providers'
import '../server/routes'
import '../main/agentProfiles'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import type { ServiceStartConfig, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { launcherSpec, serverName } from '@acorn/node-core/main/mcpRegister.ts'
import { reconcileWorktrees, setWorktreesRoot } from '@acorn/node-core/main/taskWorktree.ts'
import { logStorageFootprint } from '@acorn/node-core/main/storageFootprint.ts'
import { disposeWsHub } from '@acorn/node-core/main/wsHub.ts'
import { wireManagedAgents } from '../main/managedAgentsWiring'
import { createManagedWorkflowStepRunner } from '../main/managedWorkflowStep'
import { wireServerBridges } from '../main/serverBridges'
import { wireRunBridge } from '../main/harnessWiring'
import { wireAgentTools } from '../main/agentToolsWiring'
import { wireContextSections } from '../main/contextSectionsWiring'
import { registerWorkflowIpc } from '../main/workflowWiring'
import { wireConfigTrust } from '../main/configTrustWiring'
import { prepareSecurityState } from '../main/startupSecurity'
import { registerKnowledgeIpc } from '../../plugins/memory/main/knowledgeIpc'
import { createRuntimeService } from '../../plugins/terminal/main/runIpc'
import {
  configureTerminalMcp,
  disposeTerminal,
  reconcileTmux,
  refreshAcornMcpRegistrations,
  registerTerminalIpc,
  sendToAgent,
  terminalRunGlue,
} from '../../plugins/terminal/main/terminal'
import { endDbPools } from '../../plugins/database/main/database'
import { disposeDocker } from '../../plugins/docker/main/dockerService'
import { seedTaskNotes } from '../../plugins/notes/main/seedTaskNotes'
import { previewRulesForTask } from '../../plugins/preview/server/previewRules'

export type ServiceRuntime = {
  previewRules(taskId: string): ReturnType<typeof previewRulesForTask>
  stop(): Promise<void>
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
  const startedAt = Date.now()
  await inheritLoginShellPath(config.isPackaged)
  configureTerminalMcp(
    serverName(config.isPackaged),
    launcherSpec(config.electronPath, config.mcpEntry, serverName(config.isPackaged)),
  )

  let server: ServerType | null = null
  let managedAgents: ReturnType<typeof wireManagedAgents> | null = null
  let reconcileTask: Promise<void> | null = null
  let stopped = false
  let dbClosed = false

  stateChanged('migrating')
  let runtime: ReturnType<typeof makeRuntime>
  try {
    runtime = makeRuntime(config.dataDir)
  } catch (error) {
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
    stateChanged('stopped')
    mark('teardown')
  }

  try {
    await prepareSecurityState(runtime)
    mark('migrate')

    const worktreesDir = join(config.dataDir, 'worktrees')
    setWorktreesRoot(worktreesDir)
    const internalApiEnv = { ACORN_API_URL: config.origin, ACORN_API_TOKEN: runtime.INTERNAL_TOKEN }

    let finishReconcile!: () => void
    const reconciled = new Promise<void>((resolve) => (finishReconcile = resolve))
    let reconcileComplete = false

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
      currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
      memoryReviewTrigger: knowledge.memoryReviewTrigger,
    })
    const workflowRunner = await registerWorkflowIpc(db, {
      runtime: runtimeService,
      notesStore: knowledge.notesStore,
      internalApiEnv,
      reconciled,
      currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
      memoryReviewTrigger: knowledge.memoryReviewTrigger,
      runManagedStep: createManagedWorkflowStepRunner(managedAgents),
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

    server = await startListener(runtime, { clientDir: config.clientDir })
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
      reconcileComplete = true
      finishReconcile()
      if (!stopped) stateChanged('ready')
    })()

    return {
      previewRules: (taskId) => previewRulesForTask(db, taskId),
      stop,
    }
  } catch (error) {
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    await stop()
    throw error
  }
}
