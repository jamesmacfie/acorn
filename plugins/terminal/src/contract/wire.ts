// Terminal-owned session and PTY payload contracts.
import type { AgentState } from '@acorn/protocol/sessionActivity.ts'
import { z } from 'zod'
export type TerminalSession = {
  id: string
  title: string
  kind: 'shell' | 'agent'
  profileId: string
  backend: 'node-pty' | 'tmux'
  status: 'running' | 'exited'
  idle: boolean // agent has produced no output for a while (docs/terminal/activity.md § Activity and status); always false for shells
  agentState: AgentState // docs/terminal/activity.md § Activity and status: PTY tier emits working|idle|blocked|unknown
  // cwd is the task's isolated worktree, derived and never stored: `tasks.worktreePath` is the truth
  // (docs/workspaces-and-tasks.md), and main computes `cwd === task.worktreePath` at session create
  // and during `reconcileTmux`, so the flag survives app restarts. It stays on the wire as a
  // denormalized copy so the renderer doesn't need the task join for a per-session badge/cleanup
  // affordance.
  isWorktree: boolean
  taskId: string // → tasks.id (docs/workspaces-and-tasks.md); a session always belongs to a task
  agentSessionId?: string // managed→terminal controller handoff lineage
  cwd: string
  command: string
  tmuxSession?: string
  repo?: { owner: string; name: string } // derived from the task join (main process)
  pull?: { number: number } // derived from the task join (main process)
  cols: number
  rows: number
  createdAt: number
  exitCode: number | null
}

export type CreateOpts = {
  taskId: string // → tasks.id (docs/workspaces-and-tasks.md); repo / branch / PR derive from it
  profileId?: string // defaults to the built-in 'shell'
  cwd?: string
  cols?: number
  rows?: number
  title?: string
  isWorktree?: boolean
  // Dev-server pane (docs/workspaces-and-tasks.md): run this command line via the user's shell instead of a
  // profile binary, with `env` merged in (e.g. PORT). The command is user-configured per repo.
  command?: string
  env?: Record<string, string>
  // Service-owned handoff metadata. Renderer-created terminal sessions leave this absent.
  agentSessionId?: string
}

// A launchable profile as the renderer sees it (docs/terminal.md § Profiles). `available` is false when the command
// isn't on PATH, the UI disables it. command/backend stay in main. `tmuxMissing` is true when the
// profile prefers the durable tmux backend but tmux isn't installed, so a session would silently
// degrade to node-pty (no restart survival). The drawer surfaces the hint.
export type TerminalProfile = {
  id: string
  label: string
  kind: 'shell' | 'agent'
  available: boolean
  tmuxMissing?: boolean
}

// Pushed from main to a subscribed renderer inside a `term:out` WebSocket frame (shared/ws.ts;
// wsHub → wsClient).
export type ServerMsg =
  | { type: 'ready'; session: TerminalSession; replayed: boolean } // replayed = a canonical display snapshot follows
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; code: string; message: string }

const terminalSessionSchema: z.ZodType<TerminalSession> = z.object({
  id: z.string(), title: z.string(), kind: z.enum(['shell', 'agent']), profileId: z.string(),
  backend: z.enum(['node-pty', 'tmux']), status: z.enum(['running', 'exited']), idle: z.boolean(),
  agentState: z.enum(['starting', 'working', 'waiting', 'idle', 'blocked', 'permission', 'done', 'unknown']),
  isWorktree: z.boolean(), taskId: z.string(), agentSessionId: z.string().optional(),
  cwd: z.string(), command: z.string(), tmuxSession: z.string().optional(),
  repo: z.object({ owner: z.string(), name: z.string() }).optional(),
  pull: z.object({ number: z.number() }).optional(), cols: z.number(), rows: z.number(),
  createdAt: z.number(), exitCode: z.number().nullable(),
})

export const terminalServerMsgSchema: z.ZodType<ServerMsg> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), session: terminalSessionSchema, replayed: z.boolean() }),
  z.object({ type: z.literal('output'), data: z.string() }),
  z.object({ type: z.literal('exit'), exitCode: z.number().nullable(), signal: z.string().nullable() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])
