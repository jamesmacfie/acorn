// "Open a new terminal running this harness's CLI." The desktop shell used to carry these two by
// name until 2026-08-31, which meant a third harness needed a shell edit.
// The profile ids are this plugin's own (../../server/profiles/), so the commands are too.
//
// The shell keeps `task.terminal.toggle` and `task.terminal.new-shell`: a drawer and a plain shell
// are the terminal's, not any harness's.
import {
  activeTaskId, addSession, requestTerminalFocus, setTerminalOpen, type CommandContribution,
} from '@acorn/plugin-api/client'
import { terminalSessions } from '@acorn/plugin-terminal/contract/sessionsClient.ts'

async function openProfile(taskId: string, profileId: string): Promise<void> {
  const session = await terminalSessions.create({ taskId, profileId })
  setTerminalOpen(taskId, true)
  addSession(session) // create returns the session, so there is no list round trip before focusing it
  requestTerminalFocus(taskId, session.id)
}

const command = (id: string, title: string, hint: string, profileId: string): CommandContribution => ({
  id,
  title,
  hint,
  category: 'terminal',
  palette: true,
  // Two questions, both real: does this node run terminals at all, and is there a task to run one in.
  // These are app-lifetime registrations, unlike the shell's per-task ones.
  requires: { plugin: 'terminal' },
  when: () => !!activeTaskId(),
  run: () => {
    const taskId = activeTaskId()
    if (taskId) void openProfile(taskId, profileId)
  },
})

export const harnessTerminalCommands: readonly CommandContribution[] = [
  command('task.terminal.new-claude', 'New Claude Code terminal', 'run claude in the task worktree', 'claude-code'),
  command('task.terminal.new-codex', 'New Codex terminal', 'run codex in the task worktree', 'codex'),
]
