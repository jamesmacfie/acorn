// terminal.sessions, client side: spawn a PTY session in a task's worktree from another plugin's UI.
//
// The deliberate twin of contract/sessions.ts, which declares the same two verbs as a NODE capability for
// the same consumer and the same reason. Both exist because plugins/agents' terminal handoff genuinely
// needs to start a shell running a provider's `resume` command — on the node when the runtime does it, and
// in the renderer when the user clicks a roster row.
//
// Why this is a contract file and not client/: `client/terminalClient.ts` is the RENDERER's PTY surface —
// eight verbs including `write`, `attach`, `kill` and `resize` — and importing it was the whole
// `agents -> terminal` coupling edge. A consumer that wants to open a session should not thereby get the
// ability to type into every session on the node. Same narrowing argument contract/sessions.ts makes for
// the node half, applied to the half that was still open.
//
// Only `create` and `list`. Streams, input, teardown and profile enumeration stay terminal's own: a plugin
// that finds it needs those is describing a slot, not a capability.
//
// Names nothing from the plugin's internals — both types come from @acorn/protocol, which is what the
// contract-purity boundary rule requires.
import { terminalSessionsRoute } from '@acorn/protocol/api.ts'
import type { CreateOpts, TerminalSession } from '@acorn/protocol/terminal.ts'
import { readJson, writeJson } from '@acorn/client-core/apiClient.ts'

export type TerminalSessionsClient = {
  // Spawns the PTY. The engine re-derives cwd from `taskId` — creating the task's worktree on first use —
  // so a caller supplies intent (task, profile, command, title) and never a path.
  create(opts: CreateOpts): Promise<TerminalSession>
  // Every session the engine knows about, running or exited. Filtered to the caller's own task for a
  // task-scoped credential (plugins/terminal/src/server/routes/terminal.ts); a device sees the node.
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
