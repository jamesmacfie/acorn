import { createSignal } from 'solid-js'

// The keys a phone's on-screen keyboard can't send, for the phone's terminal pane (./TerminalPane.tsx).

export type RowKey = 'escape' | 'tab' | 'up' | 'down' | 'right' | 'left'

const ARROW_FINAL: Partial<Record<RowKey, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' }

/** The bytes a key sends. An arrow follows the cursor-key mode the program running in the terminal
 *  asked for, as xterm does for a hardware arrow: `vi` and `less` switch to `ESC O`. */
export function keyBytes(key: RowKey, applicationCursorKeys: boolean): string {
  if (key === 'escape') return '\x1b'
  if (key === 'tab') return '\t'
  return `${applicationCursorKeys ? '\x1bO' : '\x1b['}${ARROW_FINAL[key]}`
}

// One keyboard per page, so one Ctrl. Armed by the key row, spent by the next input to any terminal.
export const [ctrlArmed, setCtrlArmed] = createSignal(false)

/** What a terminal sends for its input while Ctrl may be held. One typed character becomes its
 *  control code, so `c` is ETX, which interrupts. Anything else passes through and lets go of Ctrl. */
export function withCtrl(data: string): string {
  if (!ctrlArmed()) return data
  setCtrlArmed(false)
  return data.length === 1 ? controlCode(data) : data
}

// The C0 control for a character: `@`, letters and `[\]^_` lose their top bits, space is NUL and
// `?` is DEL. Any other character has no control form and is sent unchanged.
function controlCode(character: string): string {
  if (character === ' ') return '\x00'
  if (character === '?') return '\x7f'
  const code = character.toUpperCase().charCodeAt(0)
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : character
}
