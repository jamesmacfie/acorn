// Pure terminal helpers — no electron / node-pty imports, so they're unit-testable under plain Node
// (terminalUtils.test.ts). The PTY/IPC wiring that does need those lives in terminal.ts. Helpers that
// aren't terminal-specific live in core: path/checkout guards in core/main/pathGuards.ts, the
// task-scoped child environment in core/main/taskEnv.ts.

export const RING_CAP = 256 * 1024 // bytes of recent output kept per session, replayed on attach

// Keep only the last RING_CAP bytes of output for replay on attach.
export const trimRing = (ring: string): string => (ring.length > RING_CAP ? ring.slice(ring.length - RING_CAP) : ring)

// Sanitize cols/rows from the (less-trusted) renderer to a sane integer (docs/security.md).
export const clampDim = (n: unknown, fallback: number): number =>
  Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 2000 ? (n as number) : fallback

// tmux session names for our sessions. `acorn-<uuid>` — the prefix lets reconciliation pick out
// our sessions from any the user runs, and is the handle for `tmux attach -t` from a real terminal.
export const TMUX_PREFIX = 'acorn-'
export const tmuxName = (id: string) => `${TMUX_PREFIX}${id}`

// argv for the two tmux calls. new-session -A -d is create-or-noop, detached (we drive it through a
// separate attach PTY). -c sets cwd; the trailing command runs only when the session is created.
//
// `-e KEY=VAL` sets the SESSION environment explicitly (tmux ≥3.2). This is load-bearing: the tmux
// server is a singleton, and a session created against an ALREADY-RUNNING server does NOT inherit
// the env we hand execFileSync — it takes the server's stale global env plus only the
// `update-environment` whitelist, silently dropping ACORN_TASK_ID / ACORN_API_TOKEN. That made
// agent panes (tmux backend) show "connected · no tools" while shell panes (node-pty, full env)
// worked. Passing every var via -e replicates node-pty's behaviour regardless of server state.
// (Session names are unique per pane, so -A never attaches to an existing one where -e wouldn't apply.)
export const tmuxNewSessionArgs = (name: string, cwd: string, command: string, env: Record<string, string> = {}) => [
  'new-session',
  '-A',
  '-d',
  ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  '-s',
  name,
  '-c',
  cwd,
  command,
]
// -T RGB: declare the attach client truecolor-capable. TERM=xterm-256color carries no RGB
// capability in terminfo and the user's terminal-features may not add it, so without this tmux
// quantizes every 24-bit colour an agent TUI emits down to the 256 palette before xterm.js
// (which renders full truecolor) ever sees it.
export const tmuxAttachArgs = (name: string) => ['-T', 'RGB', 'attach', '-t', name]

// Parse `tmux list-sessions -F '#{session_name}'` into the set of our session names.
export const parseTmuxSessions = (stdout: string): Set<string> =>
  new Set(stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(TMUX_PREFIX)))

// Idle = a running agent whose PTY has produced no output for `idleMs` (docs/terminal-and-agents.md activity
// indicators). Backend-agnostic: silence, not transcript-scraping. Shells never count as idle —
// "waiting for input" is only meaningful for an agent.
export const IDLE_MS = 10_000
// A fresh agent's FIRST idle uses a shorter window: launch-context injection (notes/PR/memory) is
// queued 'after-ready' and only fires on that first idle edge, so the 10s "done working" heuristic
// just delays the first prompt. A booting CLI reaches its input prompt in ~1-2s; 3s of silence is a
// safe "boot settled" signal without waiting the full mid-session window (docs/notes-and-memory.md).
export const FIRST_IDLE_MS = 3_000
export const computeIdle = (
  kind: 'shell' | 'agent',
  status: 'running' | 'exited',
  lastActivityAt: number,
  now: number,
  idleMs = IDLE_MS,
): boolean => kind === 'agent' && status === 'running' && now - lastActivityAt >= idleMs

// Resolve a profile's backend preference against whether tmux is actually installed (docs/terminal-and-agents.md):
// 'tmux' degrades to 'node-pty' when tmux is missing, so durable mode is simply unavailable.
export const resolveBackend = (preference: 'node-pty' | 'tmux', tmuxAvailable: boolean): 'node-pty' | 'tmux' =>
  preference === 'tmux' && tmuxAvailable ? 'tmux' : 'node-pty'

// Blocked-prompt detection (docs/terminal-and-agents.md): when an agent session is otherwise idle, scan the
// tail of its PTY ring for a tiny const rule list of input prompts. ponytail: a heuristic with a
// known ceiling — the upgrade path is config-injected agent hooks (deferred, invasive).
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\[[0-9;?]*[a-zA-Z~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Z0-9])/g
const SPINNER_RE = /[⠁⠂⠄⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒]/g

const BLOCKED_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /do you want to proceed/i,
  /press enter/i,
]

export const TAIL_SCAN_LINES = 12

export function matchBlockedPrompt(ringTail: string): boolean {
  const cleaned = ringTail.replace(ANSI_RE, '').replace(SPINNER_RE, '').replace(/\r/g, '\n')
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-TAIL_SCAN_LINES)
  if (!lines.length) return false
  const tail = lines.join('\n')
  if (BLOCKED_PATTERNS.some((re) => re.test(tail))) return true
  // A trailing `?` counts only on the LAST line (a mid-stream question in scrollback doesn't).
  return /\?\s*$/.test(lines[lines.length - 1])
}

// Bracketed paste (docs/panes.md): agent TUIs treat the wrapped payload as ONE pasted block, so
// multi-line prompts don't submit per-line. Sanitize: strip any stray paste markers from the
// payload (a payload containing ESC[201~ would end the paste early — the injection risk) and trim
// trailing whitespace so a submit '\r' is the only terminator.
export const PASTE_BEGIN = '\x1b[200~'
export const PASTE_END = '\x1b[201~'
// eslint-disable-next-line no-control-regex
const PASTE_MARKERS = /\x1b\[20[01]~/g

export function wrapBracketedPaste(text: string): string {
  const sanitized = text.replace(PASTE_MARKERS, '').replace(/[\s\r\n]+$/, '')
  return `${PASTE_BEGIN}${sanitized}${PASTE_END}`
}
