import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { CreateOpts, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'

export type TerminalSessions = {
  // Spawns the PTY. The engine re-derives the cwd from `taskId`, creating the task's worktree if
  // this is its first use, so a caller supplies intent (task, profile, command, title) and never a
  // path.
  create(opts: CreateOpts): Promise<TerminalSession>
  // Every session the engine currently knows about, running or exited. The handoff's return path reads
  // `status` and `agentSessionId` off these to refuse re-taking control while the shell is still live.
  list(): Promise<TerminalSession[]>
  // Calls back once when a running session stops: its command exited, or the terminal was removed.
  // The handoff closes what it started for the terminal here. Answers the unsubscribe.
  onStopped(listener: (sessionId: string) => void): () => void
}

export const TERMINAL_SESSIONS = capabilityId<TerminalSessions>('terminal.sessions')
