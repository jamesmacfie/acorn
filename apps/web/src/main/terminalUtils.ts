// Pure terminal helpers — no electron / node-pty imports, so they're unit-testable under plain Node
// (terminalUtils.test.ts). The PTY/IPC wiring that does need those lives in terminal.ts.

import { resolve, sep } from 'node:path'

export const RING_CAP = 256 * 1024 // bytes of recent output kept per session, replayed on attach

// Keep only the last RING_CAP bytes of output for replay on attach.
export const trimRing = (ring: string): string => (ring.length > RING_CAP ? ring.slice(ring.length - RING_CAP) : ring)

// Sanitize cols/rows from the (less-trusted) renderer to a sane integer (vNext §5, §11).
export const clampDim = (n: unknown, fallback: number): number =>
  Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 2000 ? (n as number) : fallback

// tmux session names for our sessions. `acorn-<uuid>` — the prefix lets reconciliation pick out
// our sessions from any the user runs, and is the handle for `tmux attach -t` from a real terminal.
export const TMUX_PREFIX = 'acorn-'
export const tmuxName = (id: string) => `${TMUX_PREFIX}${id}`

// argv for the two tmux calls. new-session -A -d is create-or-noop, detached (we drive it through a
// separate attach PTY). -c sets cwd; the trailing command runs only when the session is created.
export const tmuxNewSessionArgs = (name: string, cwd: string, command: string) => ['new-session', '-A', '-d', '-s', name, '-c', cwd, command]
export const tmuxAttachArgs = (name: string) => ['attach', '-t', name]

// Parse `tmux list-sessions -F '#{session_name}'` into the set of our session names.
export const parseTmuxSessions = (stdout: string): Set<string> =>
  new Set(stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(TMUX_PREFIX)))

// Idle = a running agent whose PTY has produced no output for `idleMs` (vNext §3 activity
// indicators). Backend-agnostic: silence, not transcript-scraping. Shells never count as idle —
// "waiting for input" is only meaningful for an agent.
export const IDLE_MS = 10_000
export const computeIdle = (
  kind: 'shell' | 'agent',
  status: 'running' | 'exited',
  lastActivityAt: number,
  now: number,
  idleMs = IDLE_MS,
): boolean => kind === 'agent' && status === 'running' && now - lastActivityAt >= idleMs

// Resolve a profile's backend preference against whether tmux is actually installed (vNext §13.4):
// 'tmux' degrades to 'node-pty' when tmux is missing, so durable mode is simply unavailable.
export const resolveBackend = (preference: 'node-pty' | 'tmux', tmuxAvailable: boolean): 'node-pty' | 'tmux' =>
  preference === 'tmux' && tmuxAvailable ? 'tmux' : 'node-pty'

// PR worktree directory name (vNext §9): `<owner>-<repo>-pr-<number>` under the worktrees root.
export const worktreeDirName = (owner: string, repo: string, number: number | string) => `${owner}-${repo}-pr-${number}`

// Guard repo identifiers before they reach a filesystem path (vNext §5/§11: validate every IPC
// payload at the boundary). Allow only GitHub-legal chars and forbid a leading dot, so `..`, `/`,
// and absolute/relative traversal can't escape the worktrees root.
export const isValidRepoIdent = (s: string): boolean => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith('.')

// Is `candidate` the same as, or strictly inside, `root`? Both are resolved first, so a
// renderer-supplied path with `..` segments can't point outside the worktrees dir.
export const isContainedPath = (root: string, candidate: string): boolean => {
  const r = resolve(root)
  const c = resolve(candidate)
  return c === r || c.startsWith(r + sep)
}

// A checkout is dirty when `git status --porcelain` prints anything.
export const isDirty = (porcelain: string): boolean => porcelain.trim().length > 0

// Controlled child environment (vNext §11): preserve the few vars a shell needs, never copy
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
