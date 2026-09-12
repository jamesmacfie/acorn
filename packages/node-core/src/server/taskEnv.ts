// The environment handed to every task-scoped child process. Pure, so it runs under plain Node in
// tests. It sits in core because task lifecycle scripts, workflow steps, and MCP-backed agent tools
// all need the same env, not only PTY sessions.

import { branchSlug } from './worktrees/pathGuards'

// Controlled child environment: docs/security.md covers what a child never inherits.
export function childEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['HOME', 'PATH', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME', 'TMPDIR']) {
    const v = env[k]
    if (v) out[k] = v
  }
  // A Finder-launched macOS app may get no locale variables at all, which makes tmux classify the
  // attach client as non-UTF-8 and mangle smart punctuation and box drawing before xterm sees the
  // stream. The allowlist above keeps an explicit locale. Otherwise fall back to `en_US.UTF-8`,
  // which ships with macOS.
  if (!out.LC_ALL && !out.LC_CTYPE && !out.LANG) out.LANG = 'en_US.UTF-8'
  out.TERM = 'xterm-256color'
  // xterm.js renders 24-bit colour, but the allowlist above strips the COLORTERM a native terminal
  // sets, so agent TUIs drop to the 256-colour palette and their dim text turns unreadable. This
  // also flows into tmux panes through new-session -e, and tmux 3.2 and later read it from the
  // attach client.
  out.COLORTERM = 'truecolor'
  return out
}

// Task identity fields a session env needs. A projection of the tasks row, so this file stays free
// of drizzle types.
export type SessionTaskInfo = {
  projectId: string
  projectName: string
  github?: { owner: string; name: string } | null
  branch?: string | null
  title: string
}

// Environment for every task-scoped session and lifecycle script: the childEnv allowlist plus the
// ACORN_* identity vars that agents, MCP, setup, and teardown scripts key off. Caller-supplied
// opts.env wins, because it is spread last.
export function buildSessionEnv(opts: {
  taskId: string
  cwd: string
  task?: SessionTaskInfo | null
  env?: Record<string, string>
  baseEnv?: NodeJS.ProcessEnv
}): Record<string, string> {
  const out: Record<string, string> = {
    ...childEnv(opts.baseEnv ?? process.env),
    ACORN_TASK_ID: opts.taskId,
    ACORN_WORKTREE_PATH: opts.cwd,
  }
  if (opts.task) {
    out.ACORN_PROJECT_ID = opts.task.projectId
    out.ACORN_PROJECT_NAME = opts.task.projectName
    if (opts.task.github) out.ACORN_REPO = `${opts.task.github.owner}/${opts.task.github.name}`
    if (opts.task.branch) {
      out.ACORN_BRANCH = opts.task.branch
      out.ACORN_TASK_SLUG = branchSlug(opts.task.branch)
    }
    out.ACORN_TASK_TITLE = opts.task.title
  }
  return { ...out, ...opts.env }
}
