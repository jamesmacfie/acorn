import { type NodePlugin, RUN_TARGETS, TASK_CREATED, TASK_SESSIONS } from '@acorn/plugin-api/node'
import { NOTES_SEED_TASK } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_RUN_TARGETS } from '../contract/runTargets'
import { TERMINAL_SEND_TO_AGENT } from '../contract/sendToAgent'
import { TERMINAL_SESSIONS } from '../contract/sessions'
import { runAgentTools } from '../main/agentTools'
import { createRuntimeService } from '../main/runIpc'
import { disposeTerminal, registerTerminalIpc, sendToAgent, sessionControl, terminalRunGlue, type TerminalIpcDeps } from '../main/terminal'
import { TERMINAL_ROUTE, terminal } from '../server/routes/terminal'

// The four hooks this plugin cannot resolve for itself. TerminalIpcDeps in main/terminal.ts states each
// one's blocker: one closes over the listener origin and the internal signing key, neither of which
// exists at init, and three belong to plugins/memory, whose capability id is not in a contract/.
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
      ]
      // The repo's setup script, as a handler on core's `core:worktree-created` hook rather than the
      // single slot it used to fill (docs/plugins.md § Hooks). `transform` and not `observe` because
      // core awaits the chain: the terminal that opens next expects the setup to have finished, and an
      // observer runs alongside by design. The payload comes back untouched — there is nothing here to
      // change, only work to do before the caller carries on.
      ctx.hooks.handle('core:worktree-created', {
        id: 'setup-script',
        mode: 'transform',
        run: async (payload) => {
          await registrations.worktreeCreated(payload.taskId as string, payload.path as string)
          return { payload }
        },
      })
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
      // the session map is. Two projections consume it: the harness RunBridge, behind the renderer's
      // run pane and preview home, and the capability, which is how the agent-tool and workflow
      // projections in apps/node/src/wiring/ reach it without a mutable global.
      // `run:changed` is a core event (@acorn/protocol/nodeEvents.ts) sent from here because terminal
      // holds the process, not because it owns the fact; the core-side spelling is
      // node-core/main/notify.ts § broadcastRunTargetChanged.
      // The one decision this plugin opens to other plugins (docs/plugins.md § Hooks): a turn before a
      // process starts in a task's worktree.
      ctx.hooks.declare({
        id: 'before-run-target',
        label: 'start a run target',
        payload: { taskId: 'string', targetId: 'string', command: 'string', cwd: 'string' },
        allows: ['observe', 'veto'],
      })
      const runTargets = createRuntimeService(
        ctx.core,
        terminalRunGlue(),
        (taskId, targetId, running) => ctx.events.send({ channel: 'run:changed', taskId, targetId, running }),
        ctx.hooks,
      )
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
      // terminal.sessions (contract/sessions.ts): spawn and enumerate, for plugins/agents' terminal
      // handoff. Published as a capability so agents resolves it directly instead of reaching through
      // an app-layer bridge slot.
      ctx.capabilities.provide(TERMINAL_SESSIONS, sessionControl)
    },
    // Everything init touched, in reverse: the engine's idle-watch timer, its session displays and
    // session map, and the four slots it filled. Not the SQLite handle, which the host closes right
    // after this returns.
    //
    // The slots clear explicitly rather than trusting teardown order, or a second boot in one process
    // serves through the first boot's closures.
    dispose: () => {
      disposeTerminal()
      for (const disposable of routeDisposables) disposable.dispose()
      routeDisposables = []
    },
  }
}
