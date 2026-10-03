// Pure terminal helpers: no node-pty imports, so they are unit-testable under plain Node
// (terminalUtils.test.ts). The PTY and IPC wiring that needs those lives in terminal.ts. Helpers that
// are not terminal-specific live in core: path and checkout guards in core/server/worktrees/pathGuards.ts, the
// task-scoped child environment in core/server/taskEnv.ts.

export const RING_CAP = 256 * 1024 // bytes of recent raw output kept for prompt detection / transcript-tail analysis

const RING_BLOCK_BYTES = 4 * 1024
const RING_BLOCKS = RING_CAP / RING_BLOCK_BYTES

/** Recent raw bytes in lazy fixed-size blocks. Reads join before decoding UTF-8. */
export class OutputRing {
  private readonly blocks: (Buffer | undefined)[] = Array.from({ length: RING_BLOCKS })
  private cursor = 0
  private total = 0

  get bytes(): number {
    return this.total
  }

  push(data: string): void {
    if (!data) return
    const encoded = Buffer.from(data, 'utf8')
    // An aligned ordinary block already owns exactly its storage. Adopt it without a second
    // allocation or copy. Pooled or oversized backing storage still takes the bounded copy path.
    if (this.cursor % RING_BLOCK_BYTES === 0 && encoded.length === RING_BLOCK_BYTES &&
        encoded.byteOffset === 0 && encoded.buffer.byteLength === RING_BLOCK_BYTES) {
      this.blocks[this.cursor / RING_BLOCK_BYTES] = encoded
      this.cursor = (this.cursor + RING_BLOCK_BYTES) % RING_CAP
      this.total = Math.min(RING_CAP, this.total + RING_BLOCK_BYTES)
      return
    }
    // A large callback contributes only its suffix. Copy into our blocks so that a small retained
    // tail cannot hold the oversized input's backing allocation.
    let offset = Math.max(0, encoded.length - RING_CAP)
    while (offset < encoded.length) {
      const index = Math.floor(this.cursor / RING_BLOCK_BYTES)
      const within = this.cursor % RING_BLOCK_BYTES
      const block = this.blocks[index] ?? (this.blocks[index] = Buffer.allocUnsafeSlow(RING_BLOCK_BYTES))
      const count = Math.min(RING_BLOCK_BYTES - within, encoded.length - offset)
      encoded.copy(block, within, offset, offset + count)
      offset += count
      this.cursor = (this.cursor + count) % RING_CAP
    }
    this.total = Math.min(RING_CAP, this.total + encoded.length)
  }

  /** The last bytes, decoded once, including replacement characters at a cut UTF-8 head. */
  tail(bytes: number = RING_CAP): string {
    if (bytes <= 0 || this.total === 0) return ''
    const count = Math.min(Math.floor(bytes), this.total)
    const joined = Buffer.allocUnsafe(count)
    let position = (this.cursor - count + RING_CAP) % RING_CAP
    let copied = 0
    while (copied < count) {
      const index = Math.floor(position / RING_BLOCK_BYTES)
      const within = position % RING_BLOCK_BYTES
      const length = Math.min(RING_BLOCK_BYTES - within, count - copied)
      this.blocks[index]!.copy(joined, copied, within, within + length)
      copied += length
      position = (position + length) % RING_CAP
    }
    return joined.toString('utf8')
  }
}

// Sanitize cols/rows from the (less-trusted) client to a sane integer (docs/security.md).
export const clampDim = (n: unknown, fallback: number): number =>
  Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 2000 ? (n as number) : fallback

// tmux session names for our sessions: `acorn-<uuid>`. The prefix lets reconciliation pick out our
// sessions from any the user runs, and is the handle for `tmux attach -t` from a real terminal.
export const TMUX_PREFIX = 'acorn-'
export const tmuxName = (id: string) => `${TMUX_PREFIX}${id}`

// argv for the two tmux calls. new-session -A -d is create-or-noop, detached (a separate attach PTY
// drives it). -c sets cwd; the trailing command runs only when the session is created.
//
// `-e KEY=VAL` sets the session environment explicitly (tmux >=3.2), and it is load-bearing. The tmux
// server is a singleton, so a session created against an already-running one does not inherit the env
// handed to execFileSync. It takes the server's stale global env plus the `update-environment`
// allowlist, silently dropping ACORN_TASK_ID and ACORN_API_TOKEN. That made agent panes show
// "connected, no tools" while shell panes worked. Session names are unique per pane, so -A never
// attaches to an existing session where -e would not apply.
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
// -u: force UTF-8 output even when a GUI-launched process has no locale environment.
// Without it tmux replaces smart punctuation and box-drawing glyphs before xterm sees the stream.
// -T RGB: declare the attach client truecolor-capable. TERM=xterm-256color carries no RGB
// capability in terminfo and the user's terminal-features may not add it, so without this tmux
// quantizes every 24-bit colour an agent TUI emits down to the 256 palette.
export const tmuxAttachArgs = (name: string) => ['-u', '-T', 'RGB', 'attach', '-t', name]

// launchArgs reach node-pty as a real argv, but tmux and the -lc fallback take one shell line, so
// quote each arg here (docs/notes-and-memory.md § Context integration). The args are const strings
// from a profile definition, never user input, so the quoting handles spaces and apostrophes rather
// than acting as a trust boundary.
const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
export const launchCommandLine = (command: string, launchArgs: string[] = []): string =>
  launchArgs.length ? [command, ...launchArgs.map(shellQuote)].join(' ') : command

// Parse `tmux list-sessions -F '#{session_name}'` into the set of our session names.
export const parseTmuxSessions = (stdout: string): Set<string> =>
  new Set(stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(TMUX_PREFIX)))

// Idle threshold (docs/terminal.md § Activity and status).
export const IDLE_MS = 10_000
// First-idle threshold, shorter than IDLE_MS (docs/terminal.md § Activity and status).
export const FIRST_IDLE_MS = 3_000
export const computeIdle = (
  kind: 'shell' | 'agent',
  status: 'running' | 'exited',
  lastActivityAt: number,
  now: number,
  idleMs = IDLE_MS,
): boolean => kind === 'agent' && status === 'running' && now - lastActivityAt >= idleMs

// Degrades a profile's tmux preference to node-pty when tmux is not installed.
export const resolveBackend = (preference: 'node-pty' | 'tmux', tmuxAvailable: boolean): 'node-pty' | 'tmux' =>
  preference === 'tmux' && tmuxAvailable ? 'tmux' : 'node-pty'

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
  // Trailing '?' rule (docs/terminal.md § Activity and status).
  return /\?\s*$/.test(lines[lines.length - 1])
}

// Wraps text as one bracketed-paste block (docs/terminal.md § Sending text to an agent).
// Strips stray paste markers first, because a payload containing ESC[201~ would end the paste early,
// and trims trailing whitespace so the caller's '\r' is the only terminator.
export const PASTE_BEGIN = '\x1b[200~'
export const PASTE_END = '\x1b[201~'
// eslint-disable-next-line no-control-regex
const PASTE_MARKERS = /\x1b\[20[01]~/g

export function wrapBracketedPaste(text: string): string {
  const sanitized = text.replace(PASTE_MARKERS, '').replace(/[\s\r\n]+$/, '')
  return `${PASTE_BEGIN}${sanitized}${PASTE_END}`
}
