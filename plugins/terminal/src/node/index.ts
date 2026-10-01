import { type NodePlugin, RUN_TARGETS, TASK_CREATED, TASK_SESSIONS } from '@acorn/plugin-api/node'
import { NOTES_SEED_TASK } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_RUN_TARGETS } from '../contract/runTargets'
import { TERMINAL_SEND_TO_AGENT } from '../contract/sendToAgent'
import { TERMINAL_SESSIONS } from '../contract/sessions'
import { TERMINAL_LAUNCH_CONTEXT } from '../contract/launchContext'
import { TERMINAL_REVIEW_INPUT } from '../contract/reviewInput'
import { deliverLaunchContext } from '../server/launchContext'
import { runAgentTools } from '../server/agentTools'
import { WORKFLOW_STEP_KIND } from '../contract/workflowSteps'
import { commandStep, runTargetStep } from '../server/workflowSteps'
import { createRuntimeService } from '../server/runChannel'
import { disposeTerminal, registerTerminalChannel, reviewSnapshots, sendToAgent, sessionControl, terminalRunGlue, type TerminalChannelDeps } from '../server/terminal'
import { TERMINAL_ROUTE, terminal } from '../server/routes/terminal'

export type TerminalPluginDeps = Pick<TerminalChannelDeps, 'internalEnv' | 'reconciled'>

export const terminalPlugin = (deps: TerminalPluginDeps): NodePlugin => {
  let routeDisposables: { dispose(): void }[] = []
  let runTargets: ReturnType<typeof createRuntimeService> | null = null
  return {
    name: 'terminal',
    label: 'Terminal',
    required: true,
    emits: [{ verb: 'completed', description: 'A task agent terminal exited with bounded input available for a short read window' }],
    // This module's own URL: the chain sits at plugins/terminal/migrations beside it, and the host owns
    // open/migrate/close from there (@acorn/node-core/server/plugins/storage.ts).
    migrationsModule: import.meta.url,
    init: (ctx) => {
      // Opened and migrated by the host before init returns: registerTerminalChannel installs the handle into
      // the engine and fills the route's bridge in the same call, so no request and no PTY spawn can
      // reach an unmigrated database.
      const db = ctx.storage.open()
      ctx.extensionPoints.declare(TERMINAL_LAUNCH_CONTEXT, 'Agent launch context')
      ctx.hooks.declare({
        id: 'archive-review', label: 'capture task evidence before archive',
        payload: { taskId: 'string', sessionIds: 'string[]', terminalOutput: 'string', diff: 'string', captureStatus: 'string' },
        allows: ['transform'], timeoutMs: 5_000,
      })
      // Fills the terminal bridge, the WS stream handlers (including streamTaskId, which the task-scope
      // guard in server/transport/wsHub.ts refuses attachment without), core's archive-time task-sessions bridge and
      // its on-task-created hook, and the worktree-created hook that runs a repo's setup script.
      const registrations = registerTerminalChannel(db, ctx.core, {
        ...deps,
        launchContext: async (taskId, sessionId) => {
          await deliverLaunchContext(taskId, sessionId, ctx.extensionPoints.handlers(TERMINAL_LAUNCH_CONTEXT),
            (id, text) => sendToAgent(id, text, 'after-ready'), (message) => ctx.log.warn(message))
        },
        completed: (event) => ctx.events.send({ channel: 'plugin:terminal:completed', ...event }),
        archiveReview: async ({ taskId, sessionIds, terminalOutput, diff }) => {
          const result = await ctx.hooks.run('archive-review', { taskId, sessionIds, terminalOutput, diff, captureStatus: 'pending' })
          if (result.payload.captureStatus === 'failed') throw new Error('Findings archive capture failed')
        },
        seedTaskNotes: (task) => ctx.capabilities.get(NOTES_SEED_TASK)?.(task) ?? Promise.resolve(),
        // `terminal:sessions-changed`, not `ctx.events.status`. This fires on every idle-to-working
        // edge, which is machine speed, and the old ping had six subscribers. Written as a frame here for
        // the same reason `run:changed` is: `ctx.events` is the seam and a plugin does not
        // deep-import server/notify.ts.
        status: () => ctx.events.send({ channel: 'terminal:sessions-changed' }),
        worktreeChanged: ctx.events.worktreeStatus,
        streams: ctx.events.streams,
      })
      routeDisposables = [
        ctx.capabilities.provide(TERMINAL_ROUTE, registrations.terminal),
        ctx.capabilities.provide(TASK_SESSIONS, registrations.taskSessions),
        ctx.capabilities.provide(TASK_CREATED, registrations.taskCreated),
        ctx.capabilities.provide(TERMINAL_REVIEW_INPUT, {
          read: async (taskId, sessionId) => reviewSnapshots.read(taskId, sessionId),
        }),
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
              message: `${running} terminal${running === 1 ? ' is' : 's are'} still running`,
            }
            : null
        },
      })
      ctx.routes.register(terminal, { prefix: '', note: '/sessions, /profiles — PTY control only' })

      // Run targets are terminal sessions in the task worktree, so the service can only be built where
      // the session map is. Two projections consume it: the harness RunBridge, behind the client's
      // run pane and preview home, and the capability, which is how the agent-tool and workflow
      // projections in apps/node/src/wiring/ reach it without a mutable global.
      // `run:changed` is a core event (@acorn/protocol/nodeEvents.ts) sent from here because terminal
      // holds the process, not because it owns the fact; the core-side spelling is
      // node-core/server/notify.ts § broadcastRunTargetChanged.
      // The one decision this plugin opens to other plugins (docs/plugins.md § Hooks): a turn before a
      // process starts in a task's worktree.
      ctx.hooks.declare({
        id: 'before-run-target',
        label: 'start a run target',
        payload: { taskId: 'string', targetId: 'string', command: 'string', cwd: 'string' },
        allows: ['observe', 'veto'],
      })
      const runTargetService = createRuntimeService(
        ctx.core,
        terminalRunGlue(),
        (taskId, targetId, running) => ctx.events.send({ channel: 'run:changed', taskId, targetId, running }),
        ctx.hooks,
      )
      runTargets = runTargetService
      routeDisposables.push(ctx.capabilities.provide(RUN_TARGETS, {
        targets: (taskId) => runTargetService.targets(taskId),
        start: (taskId, targetId) => runTargetService.start(taskId, targetId),
        stop: (taskId, targetId) => runTargetService.stop(taskId, targetId),
        restart: (taskId, targetId) => runTargetService.restart(taskId, targetId),
        status: (taskId, targetId) => runTargetService.status(taskId, targetId),
        defaultUrl: (taskId) => runTargetService.defaultUrl(taskId),
      }))
      routeDisposables.push(ctx.capabilities.provide(TERMINAL_RUN_TARGETS, runTargetService))
      // This plugin's two workflow step kinds (../server/workflowSteps.ts). Contributed rather than
      // granted, like http's: workflows opens the point and any plugin may fill it. Nothing happens on
      // a node with workflows disabled, because the point is never opened.
      ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, { id: 'command', value: commandStep(ctx.core) })
      ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, { id: 'run-target', value: runTargetStep(runTargetService) })
      // The five run_* agent tools, over the service built two lines up. The capability stays published
      // because the workflow runner's `run` step still resolves it from apps/node/src/wiring/.
      for (const tool of runAgentTools(runTargetService, ctx.events.repoConfigTrustNotice)) ctx.tools.register(tool)
      // terminal.sendToAgent (contract/sendToAgent.ts): PTY delivery for explicit actions such as
      // Memory's send-to-agent command. Consumers resolve it at call time.
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
      runTargets?.dispose()
      runTargets = null
      disposeTerminal()
      for (const disposable of routeDisposables) disposable.dispose()
      routeDisposables = []
    },
  }
}

// The composition hooks apps/node calls around plugin init: the MCP launcher, the boot-time MCP
// re-registration, and the tmux reconcile pass. Exported from the entrypoint because they are
// cross-package by definition and the engine that implements them must stay out of contract/.
export { reconcileTmux, refreshAcornMcpRegistrations } from '../server/terminal'
