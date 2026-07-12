// The main-process composition root (docs/plugins.md). One explicit place owns
// construction ORDER and LIFECYCLE — every domain module keeps its own behaviour. The ordered
// phases are visible top-to-bottom here and reversible in one disposal chain:
//
//   migrate → construct services → install bridges/IPC → start listener → create window
//   → reconcile durable state (off the paint-critical path) → dispose in reverse on quit
//
// The listener starts only AFTER the harness/context bridges are installed, closing the boot-order
// window where /api/tasks/:id/notes returned 503 and /context was empty. terminal.ts is
// no longer the accidental main() — it is just the PTY engine, wired from here.
import { app, type BrowserWindow } from 'electron'
import type { ServerType } from '@hono/node-server'
import { join } from 'node:path'
import '../server/providers' // register built-in integration providers into the core registry before the listener starts
import '../server/routes' // register plugin-owned HTTP routers into the core route registry before createApp() runs
import './agentProfiles' // register the built-in agent-profile plugins into the core registry
import { makeRuntime, startListener } from '../../core/main/server'
import { AutomationApiServer } from '../../core/main/publicApi/server'
import { ApiSettingsStore } from '../../core/main/publicApi/settingsStore'
import { buildPublicApiContributions } from '../server/publicApi'
import { setApiSettingsController } from '../../core/server/routes/apiSettings'
import { wireServerBridges } from './serverBridges'
import { registerKnowledgeIpc } from '../../plugins/memory/main/knowledgeIpc'
import { createRuntimeService } from '../../plugins/terminal/main/runIpc'
import { wireRunBridge } from './harnessWiring'
import { wireAgentTools } from './agentToolsWiring'
import { wireContextSections } from './contextSectionsWiring'
import { registerWorkflowIpc } from './workflowWiring'
import { registerPreviewIpc } from '../../plugins/preview/main/previewService'
import { endDbPools } from '../../plugins/database/main/database'
import { disposeTerminal, reconcileTmux, refreshAcornMcpRegistrations, registerTerminalIpc, sendToAgent, terminalRunGlue } from '../../plugins/terminal/main/terminal'
import { seedTaskNotes } from '../../plugins/notes/main/seedTaskNotes'
import { reconcileWorktrees, setWorktreesRoot } from '../../core/main/taskWorktree'
import { wireConfigTrust } from './configTrustWiring'
import { logStorageFootprint } from '../../core/main/storageFootprint'

// Boot/reconcile/teardown timing marks (docs/electron.md §11): hrtime deltas from boot start, logged as
// greppable one-liners. "no telemetry, no dashboards; a log you can grep."
function bootTimer(): (label: string) => void {
  const t0 = process.hrtime.bigint()
  return (label) => console.log(`[boot] ${label} +${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)}ms`)
}

export type BootstrapOptions = {
  // Writable app-data root (DB, blobs, worktrees, notes) — userData when packaged, repo-local .acorn in dev.
  dataDir: string
  // The loopback window origin (http://127.0.0.1:PORT); the internal loopback API base for agents.
  origin: string
  // Window construction stays in electron.ts (navigation hardening, auth window); the root only owns
  // WHEN it happens in the boot order.
  createWindow: () => Promise<BrowserWindow>
}

export async function bootstrap({ dataDir, origin, createWindow }: BootstrapOptions): Promise<BrowserWindow> {
  const mark = bootTimer()
  const startedAt = Date.now()

  // Teardown is registered FIRST and is idempotent, so a boot that throws part-way can still dispose
  // whatever was constructed (the lifecycle invariant: partial boot still disposes).
  let server: ServerType | null = null
  let apiServer: AutomationApiServer | null = null
  let disposePreview: (() => void) | null = null
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    try {
      await apiServer?.stop() // stop the public automation listener first (docs/public-api.md)
    } catch (e) {
      console.warn('[boot] automation API close failed:', e)
    }
    try {
      server?.close() // stop accepting loopback requests (constructed last → disposed first)
    } catch (e) {
      console.warn('[boot] server close failed:', e)
    }
    try {
      disposePreview?.() // detach + close every preview WebContentsView
    } catch (e) {
      console.warn('[boot] disposePreview failed:', e)
    }
    try {
      disposeTerminal() // clear the engine idle-watch interval
    } catch (e) {
      console.warn('[boot] disposeTerminal failed:', e)
    }
    try {
      await endDbPools() // end any open pg pools (database pane)
    } catch (e) {
      console.warn('[boot] endDbPools failed:', e)
    }
    mark('teardown')
  }
  // will-quit does not wait for async handlers — hold the quit until dispose resolves, then exit
  // for real (app.exit skips further lifecycle events, so this cannot loop).
  app.on('will-quit', (e) => {
    if (disposed) return
    e.preventDefault()
    void dispose().finally(() => app.exit())
  })

  // Gate for mutating surfaces that act on durable state the reconcile pass below recovers
  // (term:task:archive, workflow:start/gate): they await this so an early renderer action can't
  // race recovery — e.g. archiving a task whose live tmux sessions aren't re-attached yet, or
  // starting a run the workflow sweep would re-queue. Always resolved, even on reconcile failure.
  let reconcileDone!: () => void
  const reconciled = new Promise<void>((r) => (reconcileDone = r))
  // Mirrors `reconciled` as a synchronous flag for the public API /health readiness field.
  let reconcileComplete = false

  // 1. Migrate + construct the DB/runtime bindings. openDb runs migrations synchronously, so the
  //    schema is ready before the listener serves any request (docs/electron.md §11).
  const runtime = makeRuntime(dataDir)
  const db = runtime.DB
  mark('migrate')

  const worktreesDir = join(dataDir, 'worktrees')
  setWorktreesRoot(worktreesDir) // taskWorktree global — set before any service resolves a task cwd
  const internalApiEnv = { ACORN_API_URL: origin, ACORN_API_TOKEN: runtime.INTERNAL_TOKEN }

  // 2–3. Construct domain services and install their bridges/IPC. knowledge is built with the
  //       engine's exported sendToAgent (one-way dep); its memory/notes closures feed back into the
  //       engine at registerTerminalIpc. All setter-injection happens here, before the listener.
  const knowledge = registerKnowledgeIpc(db, dataDir, { sendToAgent })
  wireConfigTrust(db)

  const runtimeSvc = createRuntimeService(db, terminalRunGlue(db))
  // run targets are the harness RunBridge (wired below) — HTTP now, no separate run:* IPC.

  // Run keeps a dedicated bridge for its renderer routes; every other agent capability (notes,
  // memory, browser, git, context reads, run_* tools) is the agent-tool registry (the agent-tool registry).
  wireRunBridge(runtimeSvc)
  wireContextSections({ db, notesStore: knowledge.notesStore, reconciled: knowledge.reconciled })
  wireAgentTools({ db, notesStore: knowledge.notesStore, proposals: knowledge.proposals, runtime: runtimeSvc, reconciled: knowledge.reconciled })

  const workflowRunner = await registerWorkflowIpc(db, {
    runtime: runtimeSvc,
    notesStore: knowledge.notesStore,
    internalApiEnv,
    reconciled,
    memoryReviewTrigger: knowledge.memoryReviewTrigger,
  })
  // search, editor, local-git, and database are HTTP routes wired via wireServerBridges() — the
  // composition root owns this so core/main/server.ts stays free of plugin bridge imports.
  wireServerBridges(db)

  registerTerminalIpc(db, worktreesDir, {
    internalApiEnv,
    memoryInjector: knowledge.memoryInjector,
    memoryReviewTrigger: knowledge.memoryReviewTrigger,
    seedTaskNotes: (task) => seedTaskNotes(db, knowledge.notesStore, internalApiEnv, task),
    reconciled,
  })
  disposePreview = registerPreviewIpc() // main-owned browser-preview WebContentsView surface
  mark('install')

  // 4. Start the loopback listener — only now that every bridge is installed.
  server = await startListener(runtime)
  mark('listener-up')

  // 4b. Start the public automation API listener (docs/public-api.md). Disabled by default; it binds only
  //     when settings/env enable it. Constructed after DB/services, before the window. A bind failure
  //     is logged and does not block the app.
  apiServer = new AutomationApiServer({
    settingsStore: new ApiSettingsStore(dataDir),
    bindings: runtime,
    tokens: runtime.API_TOKENS,
    version: app.getVersion(),
    contributions: buildPublicApiContributions({
      db,
      encKey: runtime.SESSION_ENC_KEY,
      blobs: runtime.BLOBS,
      resolveGithubToken: (userId) => runtime.OAUTH_ACCOUNTS.resolveGithubToken(userId),
      notesStore: knowledge.notesStore,
      memoryProposals: knowledge.proposals,
      memoryReconcile: knowledge.reconciled,
      workflowRunner,
    }),
    runtime: {
      version: app.getVersion(),
      startedAt,
      desktop: true,
      reconciliationComplete: () => reconcileComplete,
      rendererConnected: () => runtime.UI_BROKER.rendererConnected,
      terminalAvailable: () => true,
      worktreesAvailable: () => true,
      pluginCapabilities: () => [
        { id: 'notes', available: true },
        { id: 'changes', available: true },
        { id: 'editor', available: true },
        { id: 'memory', available: true },
        { id: 'database', available: true },
        { id: 'workflows', available: true },
        { id: 'rollbar', available: true },
        { id: 'linear', available: true },
        { id: 'terminal', available: true },
        { id: 'github', available: true },
        { id: 'preview', available: true },
      ],
    },
  })
  setApiSettingsController(apiServer) // let the cookie-auth Settings page read/patch listener settings
  try {
    await apiServer.start()
    mark('automation-api')
  } catch (e) {
    console.warn('[boot] automation API failed to start:', e)
  }

  // 5. Create the window as soon as the listener is up (docs/electron.md §11 boot policy).
  const win = await createWindow()
  mark('window')

  // Refresh the acorn MCP registration to the current electron binary (heals a stale pnpm-store path
  // from a prior electron version). Fire-and-forget, off the paint-critical path; shells out per agent CLI.
  void refreshAcornMcpRegistrations().catch((e) => console.warn('[boot] MCP re-register failed:', e))

  // 6. Reconcile durable state AFTER the window, off the paint-critical path. The sessions/worktrees
  //    it recovers are not needed to paint the shell (docs/electron.md §11). The steps are independent —
  //    each gets its own try/catch so one failure can't skip the others (a tmux error must not
  //    leave interrupted workflow runs stuck 'running' forever).
  void (async () => {
    void logStorageFootprint(db, dataDir).catch((error) => console.warn('[storage] footprint failed:', error))
    try {
      await reconcileTmux(db)
      mark('reconcile.tmux')
    } catch (e) {
      console.warn('[boot] reconcile tmux failed:', e)
    }
    try {
      await reconcileWorktrees(db)
      mark('reconcile.worktrees')
    } catch (e) {
      console.warn('[boot] reconcile worktrees failed:', e)
    }
    try {
      await workflowRunner.reconcile()
      mark('reconcile.workflow')
    } catch (e) {
      console.warn('[boot] reconcile workflow failed:', e)
    }
    reconcileComplete = true
    reconcileDone()
  })()

  return win
}
