// The main-process composition root (review §2, docs/next Phase 1). One explicit place that owns
// construction ORDER and LIFECYCLE — every domain module keeps its own behaviour. The ordered
// phases are visible top-to-bottom here and reversible in one disposal chain:
//
//   migrate → construct services → install bridges/IPC → start listener → create window
//   → reconcile durable state (off the paint-critical path) → dispose in reverse on quit
//
// The listener starts only AFTER the harness/context bridges are installed, closing the boot-order
// window where /api/tasks/:id/notes 503'd and /context returned empty (review §2). terminal.ts is
// no longer the accidental main() — it is just the PTY engine, wired from here.
import { app, type BrowserWindow } from 'electron'
import type { ServerType } from '@hono/node-server'
import { join } from 'node:path'
import { makeRuntime, startListener } from './server'
import { registerKnowledgeIpc } from './knowledgeIpc'
import { createRuntimeService } from './runIpc'
import { wireRunBridge } from './harnessWiring'
import { wireAgentTools } from './agentToolsWiring'
import { wireContextSections } from './contextSectionsWiring'
import { registerWorkflowIpc } from './workflowWiring'
import { endDbPools } from './database'
import { disposeTerminal, reconcileTmux, registerTerminalIpc, sendToAgent, terminalRunGlue } from './terminal'
import { seedTaskNotes } from './seedTaskNotes'
import { reconcileWorktrees, setWorktreesRoot } from './taskWorktree'

// Boot/reconcile/teardown timing marks (performance §3.1): hrtime deltas from boot start, logged as
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

  // Teardown is registered FIRST and is idempotent, so a boot that throws part-way can still dispose
  // whatever was constructed (Phase 1 acceptance: partial boot still disposes).
  let server: ServerType | null = null
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    try {
      server?.close() // stop accepting loopback requests (constructed last → disposed first)
    } catch (e) {
      console.warn('[boot] server close failed:', e)
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

  // 1. Migrate + construct the DB/runtime bindings. openDb runs migrations synchronously, so the
  //    schema is ready before the listener serves any request (performance §3.6).
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

  const runtimeSvc = createRuntimeService(db, terminalRunGlue(db))
  // run targets are the harness RunBridge (wired below) — HTTP now, no separate run:* IPC (Phase 3).

  // Run keeps a dedicated bridge for its renderer routes; every other agent capability (notes,
  // memory, browser, git, context reads, run_* tools) is the agent-tool registry (Phase 4).
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
  // search, editor, local-git, and database are HTTP routes wired via wireServerBridges().

  registerTerminalIpc(db, worktreesDir, {
    internalApiEnv,
    memoryInjector: knowledge.memoryInjector,
    memoryReviewTrigger: knowledge.memoryReviewTrigger,
    seedTaskNotes: (task) => seedTaskNotes(db, knowledge.notesStore, internalApiEnv, task),
    reconciled,
  })
  mark('install')

  // 4. Start the loopback listener — only now that every bridge is installed.
  server = await startListener(runtime)
  mark('listener-up')

  // 5. Create the window as soon as the listener is up (performance §3.6 boot policy).
  const win = await createWindow()
  mark('window')

  // 6. Reconcile durable state AFTER the window, off the paint-critical path. The sessions/worktrees
  //    it recovers are not needed to paint the shell (performance §3.6). The steps are independent —
  //    each gets its own try/catch so one failure can't skip the others (a tmux error must not
  //    leave interrupted workflow runs stuck 'running' forever).
  void (async () => {
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
    reconcileDone()
  })()

  return win
}
