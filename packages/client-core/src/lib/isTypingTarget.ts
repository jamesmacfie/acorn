// Client import seam for the cross-runtime typing predicate.
export { isTypingTarget } from '@acorn/protocol/keybindings.ts'

// xterm focuses a hidden textarea, so the terminal reads as a typing target, but Cmd chords are
// never terminal input on macOS (xterm leaves them to the browser), so chord shortcuts may fire
// there. Bare-key shortcuts must still stay off: those keystrokes are terminal input.
export function isTerminalTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('.terminal-surface')
}
