import { type NodePlugin, RUN_TARGETS, TASK_CREATED, TASK_SESSIONS, WORKTREE_CREATED } from '@acorn/plugin-api/node'
import { NOTES_SEED_TASK } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_RUN_TARGETS } from '../contract/runTargets'
import { TERMINAL_SEND_TO_AGENT } from '../contract/sendToAgent'
import { TERMINAL_SESSIONS } from '../contract/sessions'
import { runAgentTools } from '../main/agentTools'
import { createRuntimeService } from '../main/runIpc'
import { disposeTerminal, registerTerminalIpc, sendToAgent, sessionControl, terminalRunGlue, type TerminalIpcDeps } from '../main/terminal'
import { TERMINAL_ROUTE, terminal } from '../server/routes/terminal'

// The four hooks this plugin still cannot resolve for itself. Each one's blocker is stated on
// TerminalIpcDeps in main/terminal.ts; in short, one closes over the listener origin and the internal
// signing key (neither exists at init), and three belong to plugins/memory whose capability id is
// deliberately not in a contract/.
export type TerminalPluginDeps = Omit<TerminalIpcDeps, 'seedTaskNotes'>

export const terminalPlugin = (deps: TerminalPluginDeps): NodePlugin => {
  let routeDisposables: { dispose(): void }[] = []
  return {
    name: 'terminal',
    required: true,
    // This module's own URL: the chain sits at plugins/terminal/migrations beside it, and the host owns
    // open/migrate/close from there (@acorn/node-core/main/pluginStorage.ts).
    migrationsModule: import.meta.url,
    init: (ctx) => {
      // Opened and migrated by the host before init returns: registerTerminalIpc installs the handle into
      // the engine and fills the route's bridge in the same call, so no request and no PTY spawn can
      // reach an unmigrated database.
      const db = ctx.storage.open()
      // Fills the terminal bridge, the WS stream handlers (including streamTaskId, which the task-scope
      // guard in main/wsHub.ts refuses attachment without), core's archive-time task-sessions bridge and
      // its on-task-created hook, and the worktree-created hook that runs a repo's setup script.
      const registrations = registerTerminalIpc(db, ctx.core, {
        ...deps,
        seedTaskNotes: (task) => ctx.capabilities.get(NOTES_SEED_TASK)?.(task) ?? Promise.resolve(),
        status: ctx.events.status,
        streams: ctx.events.streams,
      })
      routeDisposables = [
        ctx.capabilities.provide(TERMINAL_ROUTE, registrations.terminal),
        ctx.capabilities.provide(TASK_SESSIONS, registrations.taskSessions),
        ctx.capabilities.provide(TASK_CREATED, registrations.taskCreated),
        ctx.capabilities.provide(WORKTREE_CREATED, registrations.worktreeCreated),
      ]
      // Archiving stops a task's live sessions (the guard and the kill both go through the bridge
      // above), so this is disclosure rather than an offer: no `apply`, because core already does it.
      ctx.taskChecks.register({
        id: 'sessions',
        check: async (task) => {
          const running = registrations.taskSessions.runningCount(task.id)
          return running
            ? {
              id: 'running',
              severity: 'warn' as const,
              message: `${running} active session${running === 1 ? '' : 's'}`,
            }
            : null
        },
      })
      ctx.routes.register(terminal, { prefix: '', note: '/sessions, /profiles — PTY control only' })

      // Run targets are terminal sessions in the task worktree, so the service can only be built where
      // the session map is. Two projections consume it: the harness RunBridge (the renderer's run pane
      // and preview home), filled here rather than from an app-layer wireRunBridge, and the capability,
      // which is how the agent-tool and workflow projections in apps/node/src/wiring/ reach it without
      // reading a mutable global out of this plugin.
      const runTargets = createRuntimeService(ctx.core, terminalRunGlue())
      routeDisposables.push(ctx.capabilities.provide(RUN_TARGETS, {
        targets: (taskId) => runTargets.targets(taskId),
        start: (taskId, targetId) => runTargets.start(taskId, targetId),
        stop: (taskId, targetId) => runTargets.stop(taskId, targetId),
        restart: (taskId, targetId) => runTargets.restart(taskId, targetId),
        status: (taskId, targetId) => runTargets.status(taskId, targetId),
        defaultUrl: (taskId) => runTargets.defaultUrl(taskId),
        }))
      ctx.capabilities.provide(TERMINAL_RUN_TARGETS, runTargets)
      // The five run_* agent tools, over the service built two lines up. The capability stays published
      // because the workflow runner's `run` step still resolves it from apps/node/src/wiring/.
      for (const tool of runAgentTools(runTargets, ctx.events.repoConfigTrustNotice)) ctx.tools.register(tool)
      // terminal.sendToAgent (contract/sendToAgent.ts): the PTY delivery primitive plugins/memory's
      // launch injector needs. Published rather than exported into a dep bag, so memory resolves it at
      // call time and degrades to a no-op when this plugin is absent.
      ctx.capabilities.provide(TERMINAL_SEND_TO_AGENT, sendToAgent)
      // terminal.sessions (contract/sessions.ts): spawn + enumerate, for plugins/agents' terminal
      // handoff. Published rather than left as an app-layer reach into `terminalBridgeSlot`, which is
      // what apps/node/src/wiring/managedAgentsWiring.ts did before agents became a plugin able to
      // resolve a capability of its own.
      ctx.capabilities.provide(TERMINAL_SESSIONS, sessionControl)
    },
    // Everything init reached out and touched, in reverse: the engine's idle-watch timer, its session
    // displays and session map, and the four slots it filled. The SQLite handle is not in the list any
    // more — the host closes it right after this returns, which is the same point in the drain.
    //
    // The slots are cleared explicitly rather than trusting teardown order. disposeWsHub also clears the
    // hub, and the process is usually about to exit, but "release what init opened" has to hold on its
    // own or a second boot in one process serves through the first boot's closures.
    dispose: () => {
      disposeTerminal()
      for (const disposable of routeDisposables) disposable.dispose()
      routeDisposables = []
    },
  }
}
