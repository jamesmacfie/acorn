import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { setRunBridge } from '@acorn/node-core/server/routes/harness.ts'
import { setOnTaskCreated, setTaskSessionsBridge } from '@acorn/node-core/server/routes/worktree.ts'
import { setOnWorktreeCreated } from '@acorn/node-core/main/taskWorktree.ts'
import { TERMINAL_RUN_TARGETS } from '../contract/runTargets'
import { TERMINAL_SEND_TO_AGENT } from '../contract/sendToAgent'
import { TERMINAL_SESSIONS } from '../contract/sessions'
import { runAgentTools } from '../main/agentTools'
import { createRuntimeService } from '../main/runIpc'
import { disposeTerminal, registerTerminalIpc, sendToAgent, sessionControl, terminalRunGlue, type TerminalIpcDeps } from '../main/terminal'
import { setTerminalBridge, terminal } from '../server/routes/terminal'
import { migrationsDir } from './migrations'

// The four hooks this plugin still cannot resolve for itself. Each one's blocker is stated on
// TerminalIpcDeps in main/terminal.ts; in short, one closes over the listener origin and the internal
// signing key (neither exists at init), and three belong to plugins/memory whose capability id is
// deliberately not in a contract/.
export type TerminalPluginDeps = TerminalIpcDeps

export const terminalPlugin = (dataDir: string, deps: TerminalPluginDeps): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'terminal',
    required: true,
    init: (ctx) => {
      // Opened and migrated before the listener binds: registerTerminalIpc installs the handle into the
      // engine and fills the route's bridge in the same call, so no request and no PTY spawn can reach
      // an unmigrated database.
      db = openPluginDb(dataDir, 'terminal', { migrationsFolder: migrationsDir() })
      // Fills the terminal bridge, the WS stream handlers (including streamTaskId, which the task-scope
      // guard in main/wsHub.ts refuses attachment without), core's archive-time task-sessions bridge and
      // its on-task-created hook, and the worktree-created hook that runs a repo's setup script.
      registerTerminalIpc(db, ctx.core, deps)
      ctx.routes.register(terminal, { prefix: '', note: '/sessions, /profiles — PTY control only' })

      // Run targets are terminal sessions in the task worktree, so the service can only be built where
      // the session map is. Two projections consume it: the harness RunBridge (the renderer's run pane
      // and preview home), filled here rather than from an app-layer wireRunBridge, and the capability,
      // which is how the agent-tool and workflow projections in apps/node/src/wiring/ reach it without
      // reading a mutable global out of this plugin.
      const runTargets = createRuntimeService(ctx.core, terminalRunGlue())
      setRunBridge({
        targets: (taskId) => runTargets.targets(taskId),
        start: (taskId, targetId) => runTargets.start(taskId, targetId),
        stop: (taskId, targetId) => runTargets.stop(taskId, targetId),
        restart: (taskId, targetId) => runTargets.restart(taskId, targetId),
        status: (taskId, targetId) => runTargets.status(taskId, targetId),
        defaultUrl: (taskId) => runTargets.defaultUrl(taskId),
      })
      ctx.capabilities.provide(TERMINAL_RUN_TARGETS, runTargets)
      // The five run_* agent tools, over the service built two lines up. The capability stays published
      // because the workflow runner's `run` step still resolves it from apps/node/src/wiring/.
      for (const tool of runAgentTools(runTargets)) ctx.tools.register(tool)
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
    // displays and session map, the four slots it filled, and its own WAL-mode SQLite file — which has
    // to be closed before the data root's lock is dropped (the composition root's teardown invariant).
    //
    // The slots are cleared explicitly rather than trusting teardown order. disposeWsHub also clears the
    // hub, and the process is usually about to exit, but "release what init opened" has to hold on its
    // own or a second boot in one process serves through the first boot's closures.
    dispose: () => {
      disposeTerminal()
      setTerminalBridge(null)
      setTaskSessionsBridge(null)
      setOnTaskCreated(null)
      setOnWorktreeCreated(null)
      setRunBridge(null)
      db?.close()
      db = null
    },
  }
}
