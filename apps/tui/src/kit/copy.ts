// The clipboard from a terminal, which is OSC 52 or nothing.
//
// `CopyButton`'s level is `fallback` because a terminal cannot reach the clipboard portably: the
// escape sequence goes to the emulator, the emulator decides, and there is no reply to read. Where
// the emulator is one that takes it the button works and the level is `full` at runtime; where it is
// not, the caller prints the value for the reader to copy by hand.
//
// The allowlist is emulators that document OSC 52 support. It is a list rather than "try it and see"
// because a terminal that ignores the sequence ignores it silently, and a copy button that says it
// copied and did not is worse than one that says it cannot.

const SUPPORTS = ['xterm', 'alacritty', 'kitty', 'wezterm', 'foot', 'contour', 'rio']

/** Does this terminal say it takes OSC 52? tmux and screen pass it through when `set-clipboard` is
 *  on, which we cannot see from here, so both are left off the list. `ACORN_TUI_OSC52` overrides in
 *  either direction, for a person who knows their own terminal better than this does. */
export function supportsClipboard(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ACORN_TUI_OSC52 === '0') return false
  if (env.ACORN_TUI_OSC52 === '1') return true
  const term = `${env.TERM_PROGRAM ?? ''} ${env.TERM ?? ''}`.toLowerCase()
  return SUPPORTS.some((name) => term.includes(name))
}

/** The sequence itself. Split out so a test can read it without writing to anyone's terminal. */
export const osc52 = (text: string): string =>
  // The payload is base64 by the sequence's own definition, which also means the text cannot end the
  // sequence early whatever is in it.
  `\u001b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\u0007`

/** Hand the text to the terminal's clipboard. Returns whether it was sent, which is as close to
 *  "copied" as this host can get. */
export function copyToTerminal(text: string, out: NodeJS.WritableStream = process.stdout): boolean {
  if (!supportsClipboard()) return false
  out.write(osc52(text))
  return true
}
