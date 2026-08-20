// terminal.sessions, client side: spawn a PTY session in a task's worktree from another plugin's UI.
//
// The twin of contract/sessions.ts, which declares the same two verbs as a node capability for the same
// consumer. Both exist because plugins/agents' terminal handoff needs to start a shell running a
// provider's `resume` command, on the node when the runtime does it and in the renderer when the user
// clicks a roster row.
//
// A contract file rather than client/, because `client/terminalClient.ts` is the renderer's full PTY
// surface (eight verbs including `write`, `attach`, `kill` and `resize`) and importing it was the whole
// agents-to-terminal coupling edge. A consumer that wants to open a session shouldn't thereby get the
// ability to type into every session on the node.
//
// Only `create` and `list`. Streams, input, teardown and profile enumeration stay terminal's own: a
// plugin that needs those is describing a slot, not a capability.
import { terminalSessionsRoute } from './routes'
import type { CreateOpts, TerminalSession } from '@acorn/protocol/terminal.ts'
import { readJson, writeJson } from '@acorn/plugin-api/client'

export type TerminalSessionsClient = {
  // Spawns the PTY. The engine re-derives cwd from `taskId`, creating the task's worktree on first use,
  // so a caller supplies intent (task, profile, command, title) and never a path.
  create(opts: CreateOpts): Promise<TerminalSession>
  // Every session the engine knows about, running or exited. Filtered to the caller's own task for a
  // task-scoped credential; a device sees the node.
  list(): Promise<TerminalSession[]>
}

export const terminalSessions: TerminalSessionsClient = {
  create: (opts) =>
    writeJson<TerminalSession>(terminalSessionsRoute, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  list: () => readJson<TerminalSession[]>(terminalSessionsRoute),
}
