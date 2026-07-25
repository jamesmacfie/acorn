// The environment handed to every task-scoped child process. Pure — no electron / node-pty imports,
// so it's unit-testable under plain Node (taskEnv.test.ts). This sits in core because task lifecycle
// scripts, workflow steps and MCP-backed agent tools all need the same env, not just PTY sessions.

import { branchSlug } from './pathGuards'

// Controlled child environment (docs/security.md): preserve the few vars a shell needs, never copy
// SESSION_ENC_KEY / GITHUB_CLIENT_SECRET (or anything else) into the child.
export function childEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['HOME', 'PATH', 'SHELL', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'TMPDIR']) {
    const v = env[k]
    if (v) out[k] = v
  }
  out.TERM = 'xterm-256color'
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
  return { ...out, ...(opts.env ?? {}) }
}
