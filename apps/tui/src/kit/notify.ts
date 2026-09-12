// Asking the host terminal to raise a notification, which is an escape sequence and nothing else
// (docs/notifications.md § The channels).
//
// Shaped like ./copy.ts, and for the same reason: a terminal takes a sequence and never answers, so
// what this host can honestly say is "sent", not "shown". The emulators that take one are a list
// rather than "try it and see", because one that does not know the sequence ignores it silently.
//
// Pure on purpose. `apps/tui/src/platform.ts` imports this to install the seam's `notify` group, and
// that file is evaluated before `window.acorn` exists — so nothing here may reach client-core, which
// reaches the node. The sink that turns a notice into a call is client-core's own `initSystemNotices`,
// mounted by the shell once the seam is up.
import { createSignal } from 'solid-js'

/** `off`, `bell`, `terminal`, or `both`, the same shape as `ACORN_TUI_OSC52`. There is no device
 *  preference store here, so the environment is the switch. Anything unrecognised reads as `both`,
 *  which is the default.
 *
 *  Here rather than in ./bell.ts, where phase 3 left it, because both channels read it and this is
 *  the file the platform seam may import. `bell.ts` re-exports it. */
export type NotifyMode = 'off' | 'bell' | 'terminal' | 'both'

export function notifyMode(env: NodeJS.ProcessEnv = process.env): NotifyMode {
  const mode = env.ACORN_TUI_NOTIFY
  return mode === 'off' || mode === 'bell' || mode === 'terminal' ? mode : 'both'
}

export const BEL = '\u0007'

const ESC = '\u001b'
const ST = `${ESC}\\`

/** Which sequence this terminal takes, or null for one that takes none. */
export type NotifyBackend = 'osc9' | 'osc99' | 'osc777'

/**
 * Read the terminal's own name for itself.
 *
 * `TERM_PROGRAM` first, because that is the one an emulator sets about itself; `TERM` is the terminfo
 * entry and a reader may have overridden it. Warp is on the OSC 9 list rather than the OSC 777 one it
 * also documents, because OSC 9 is what iTerm2, Ghostty and WezTerm take too, and one sequence for
 * four terminals is one thing to get wrong. A plain bell is still a sensible setting in Warp: it
 * turns one into a badge on the tab by itself, which is why `bell` is a mode rather than a downgrade.
 */
export function detectBackend(env: NodeJS.ProcessEnv = process.env): NotifyBackend | null {
  const program = env.TERM_PROGRAM ?? ''
  if (program === 'iTerm.app' || program === 'ghostty' || program === 'WezTerm' || program === 'WarpTerminal') return 'osc9'
  // Kitty announces itself in the environment rather than in `TERM_PROGRAM`, and it is asked before
  // the `TERM` table because a kitty inside tmux reports `TERM=screen`.
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return 'osc99'
  const term = env.TERM ?? ''
  if (term === 'xterm-ghostty' || term.includes('wezterm')) return 'osc9'
  if (term.includes('rxvt')) return 'osc777'
  return null
}

/** Take out of a title or a body everything that could end the sequence early or start another one.
 *  Newlines and tabs become spaces: a notification is one line, whatever the emulator does with it. */
export const sanitise = (text: string): string =>
  [...text]
    .filter((ch) => ch !== ESC && ch !== BEL && ch !== '\u009c')
    .map((ch) => (ch === '\n' || ch === '\r' || ch === '\t' ? ' ' : ch))
    .join('')

/**
 * The bytes for one notification, as the backend spells it.
 *
 * OSC 9 carries one string, so a body follows the title after a colon, which is what herdr's
 * `terminal_notify.rs` writes and what iTerm2, Ghostty, WezTerm and Warp all read. OSC 99 is kitty's
 * and has fields: `i=1:d=0` opens notification 1 with its title and `i=1:p=body` adds the body to the
 * same one. OSC 777 is urxvt's, which takes title and body as two fields of its own.
 */
export function sequence(backend: NotifyBackend, title: string, body?: string): string {
  const head = sanitise(title)
  const rest = body ? sanitise(body) : ''
  if (backend === 'osc9') return `${ESC}]9;${rest ? `${head}: ${rest}` : head}${ST}`
  if (backend === 'osc99') {
    return rest
      ? `${ESC}]99;i=1:d=0;${head}${ST}${ESC}]99;i=1:p=body;${rest}${ST}`
      : `${ESC}]99;;${head}${ST}`
  }
  // The one backend whose fields are separated by a character a title may legitimately contain, so
  // here the semicolon is the thing being escaped from.
  const field = (value: string): string => value.replaceAll(';', ',')
  return `${ESC}]777;notify;${field(head)};${field(rest)}${ST}`
}

/** Wrap a sequence so tmux hands it to the terminal underneath rather than eating it. Every ESC is
 *  doubled, which is what tmux's own passthrough asks for. */
export const wrapTmux = (seq: string): string =>
  `${ESC}Ptmux;${seq.replaceAll(ESC, `${ESC}${ESC}`)}${ST}`

/** What to write for this notification on this terminal, or the empty string when there is nothing to
 *  write: the mode is `off` or `bell`, or this terminal takes no sequence we know. */
export function notification(title: string, body?: string, env: NodeJS.ProcessEnv = process.env): string {
  const mode = notifyMode(env)
  if (mode !== 'terminal' && mode !== 'both') return ''
  const backend = detectBackend(env)
  if (!backend) return ''
  const seq = sequence(backend, title, body)
  return env.TMUX ? wrapTmux(seq) : seq
}

/**
 * Hand it to the terminal. Answers whether anything was sent, which is as close to "shown" as this
 * host gets — the same honesty `copyToTerminal` keeps about the clipboard.
 *
 * Straight to stdout, like the OSC 52 write. The renderer draws frames and offers no channel for a
 * sequence that is not part of one, and there is nothing for it to draw over anyway: the emulator
 * consumes an OSC without leaving a cell behind.
 */
export function showInTerminal(
  title: string,
  body?: string,
  out: NodeJS.WritableStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const bytes = notification(title, body, env)
  if (!bytes) return false
  out.write(bytes)
  return true
}

// The number the topbar draws, written through the platform seam's `setBadge` so that the count here
// and the number on the desktop's app icon are one call with one meaning
// (client-core/features/notifications/badge.ts). Zero draws nothing.
const [badge, setBadge] = createSignal(0)
export { badge as terminalBadge }
export const setTerminalBadge = (count: number | null): void => { setBadge(count ?? 0) }
