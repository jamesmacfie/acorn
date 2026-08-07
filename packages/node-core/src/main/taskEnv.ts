// The environment handed to every task-scoped child process. Pure — no electron / node-pty imports,
// so it's unit-testable under plain Node (taskEnv.test.ts). This sits in core because task lifecycle
// scripts, workflow steps and MCP-backed agent tools all need the same env, not just PTY sessions.

import { branchSlug } from './pathGuards'

// Controlled child environment (docs/security.md): preserve the few vars a shell needs, never copy
// SESSION_ENC_KEY / GITHUB_CLIENT_SECRET (or anything else) into the child.
export function childEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['HOME', 'PATH', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME', 'TMPDIR']) {
    const v = env[k]
    if (v) out[k] = v
  }
  // Finder-launched macOS apps may receive no locale variables at all. That makes tmux classify
  // the attach client as non-UTF-8 and replace smart punctuation / box drawing before xterm sees
  // the stream. Preserve an explicit locale above; otherwise establish the UTF-8 invariant every
  // task-scoped process expects. `en_US.UTF-8` ships with macOS and avoids overriding a user's
  // existing locale with an arbitrary language.
  if (!out.LC_ALL && !out.LC_CTYPE && !out.LANG) out.LANG = 'en_US.UTF-8'
  out.TERM = 'xterm-256color'
  // xterm.js renders full 24-bit colour, but the whitelist above strips the COLORTERM a native
  // terminal would set — so agent TUIs (Codex/Claude) downgrade to the 256-colour palette and
  // their fg/bg-blended dim text turns unreadable. Advertise truecolor explicitly; this also flows
  // into tmux panes via new-session -e, and tmux ≥3.2 reads it from the attach client too.
  out.COLORTERM = 'truecolor'
  return out
}

// Task identity fields a session env needs — a projection of the tasks row, so this stays free of
// drizzle types and testable under plain Node.
export type SessionTaskInfo = { repoOwner: string; repoName: string; branch: string; title: string }

// Environment for every task-scoped session and lifecycle script (docs/terminal-and-agents.md, docs/agent-tools.md §4): the childEnv
// whitelist (never secrets), plus the ACORN_* identity vars agents / MCP / setup / teardown scripts
// key off. Caller-supplied opts.env still wins — it's spread last.
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
    out.ACORN_REPO = `${opts.task.repoOwner}/${opts.task.repoName}`
    out.ACORN_BRANCH = opts.task.branch
    out.ACORN_TASK_SLUG = branchSlug(opts.task.branch)
    out.ACORN_TASK_TITLE = opts.task.title
  }
  return { ...out, ...opts.env }
}
