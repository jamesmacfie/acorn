// terminal.sessions, client side: spawn a PTY session in a task's worktree from another plugin's UI.
//
// The twin of contract/sessions.ts, which declares the same two verbs as a node capability for the same
// consumer. Both exist because plugins/agents' terminal handoff needs to start a shell running a
// provider's `resume` command, on the node when the runtime does it and in the client when the user
// clicks a roster row.
//
// A contract file rather than client/, because `client/terminalClient.ts` is the client's full PTY
// surface (eight verbs including `write`, `attach`, `kill` and `resize`) and importing it was the whole
// agents-to-terminal coupling edge. A consumer that wants to open a session shouldn't thereby get the
// ability to type into every session on the node.
//
// Only `create` and `list`. Streams, input, teardown and profile enumeration stay terminal's own: a
// plugin that needs those is describing a slot, not a capability.
import { terminalSessionsRoute } from '../shared/api'
import type { CreateOpts, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'
import { activeNodeId, readJson, writeJson } from '@acorn/plugin-api/client'

export type TerminalSessionsClient = {
  // Spawns the PTY. The engine re-derives cwd from `taskId`, creating the task's worktree on first use,
  // so a caller supplies intent (task, profile, command, title) and never a path.
  create(opts: CreateOpts): Promise<TerminalSession>
  // Every session the engine knows about, running or exited. Filtered to the caller's own task for a
  // task-scoped credential; a device sees the node.
  list(): Promise<TerminalSession[]>
}

// A created session can be shown before the next roster ping. The listener belongs to Terminal's
// activated client store and is removed when that client plugin is disposed.
const createdListeners = new Set<(session: TerminalSession, nodeId: string) => void>()
export function onTerminalSessionCreated(listener: (session: TerminalSession, nodeId: string) => void): () => void {
  createdListeners.add(listener)
  return () => { createdListeners.delete(listener) }
}

export const terminalSessions: TerminalSessionsClient = {
  create: async (opts) => {
    const nodeId = activeNodeId() ?? ''
    const session = await writeJson<TerminalSession>(terminalSessionsRoute, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    })
    for (const listener of createdListeners) listener(session, nodeId)
    return session
  },
  list: () => readJson<TerminalSession[]>(terminalSessionsRoute),
}
