import { capabilityId } from '@acorn/plugin-api/node'
import type { CreateOpts, TerminalSession } from '@acorn/protocol/terminal.ts'

export type TerminalSessions = {
  // Spawns the PTY. The engine re-derives the cwd from `taskId`, creating the task's worktree if
  // this is its first use, so a caller supplies intent (task, profile, command, title) and never a
  // path.
  create(opts: CreateOpts): Promise<TerminalSession>
  // Every session the engine currently knows about, running or exited. The handoff's return path reads
  // `status` and `agentSessionId` off these to refuse re-taking control while the shell is still live.
  list(): Promise<TerminalSession[]>
}

export const TERMINAL_SESSIONS = capabilityId<TerminalSessions>('terminal.sessions')
