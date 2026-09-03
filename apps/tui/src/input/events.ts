// What the terminal tells us, as five plain objects.
//
// One shape, ours, read by the keymap host, the footer, the rectangle's encoder and the test harness
// (docs/future/terminal-rewrite/architecture.md § 4). The engine in `@opentui/keymap` is generic over
// the event type and never constructs one, so this is the only definition of a keystroke in the
// client — which is what makes `../kit/render.tsx`'s `RAW_KEYS` table unnecessary. That table exists
// because the only way to press a key at OpenTUI's test input is to hand it bytes, and a name it does
// not recognise is typed one letter at a time in silence. A harness that constructs one of these has
// no spelling to get wrong.
//
// **A modifier set is the same four everywhere**, including on a mouse event where SGR reports only
// three. `super` is false on every mouse event rather than absent, because a consumer asking about a
// modifier should not have to know which device it came from.

export type Modifiers = {
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** The platform command key. A terminal emulator keeps Cmd for itself and never delivers it, so
   *  this is only ever true on Linux and Windows, under the kitty protocol
   *  (docs/tui.md § The adapter, on why every chord here is spelled with `ctrl`). */
  super: boolean
}

export const NO_MODIFIERS: Modifiers = { ctrl: false, shift: false, alt: false, super: false }

/** Press, release or repeat. A release only ever arrives from a terminal that answered the kitty
 *  request with event reporting on; a legacy terminal has no way to say it, so every legacy key is a
 *  press (./terminal.ts § KITTY_FLAGS). */
export type KeyAction = 'press' | 'release' | 'repeat'

export type KeyEvent = Modifiers & {
  type: 'key'
  /** The spelling every binding in the app uses: `up`, `return`, `pagedown`, `f6`, `tab`, or the
   *  character itself for a key that is one. Lower case, with `shift` carrying the case, because that
   *  is how `intentKeys` spells `shift+g` (packages/client-core/src/kit/keys/keymap.ts). */
  name: string
  /** What the key types, and empty for a key that types nothing. An arrow, Escape, Return and every
   *  chord type nothing: what a Return does inside a field is the edit model's decision to make from
   *  the name, not a character the parser invents. */
  text: string
  action: KeyAction
}

export type MouseButton = 'left' | 'middle' | 'right' | 'none'
export type MouseAction = 'press' | 'release' | 'move' | 'wheel'
export type WheelDirection = 'up' | 'down' | 'left' | 'right'

export type MouseEvent = Modifiers & {
  type: 'mouse'
  /** Zero-based cells, so they index the cell buffer directly. SGR counts from one and the parser
   *  takes the one off (../paint/buffer.ts). */
  x: number
  y: number
  button: MouseButton
  action: MouseAction
  /** Set on a wheel event and absent otherwise. A trackpad's horizontal scroll arrives here too. */
  wheel?: WheelDirection
}

/** Whether this terminal is the window the reader is looking at, which is the notification gate's
 *  `focused()` (../main.tsx § setHostFocused). DEC 1004 reports it; a terminal that ignores the
 *  request never sends one, and unknown counts as focused. */
export type FocusEvent = { type: 'focus'; state: 'in' | 'out' }

/** A bracketed paste, whole. The terminal brackets it so a hundred lines arrive as one event rather
 *  than as a hundred Returns, which is the difference between pasting into a composer and sending it
 *  a hundred times. */
export type PasteEvent = { type: 'paste'; text: string }

/** A new terminal size, from `SIGWINCH`. Not a byte sequence at all, but it arrives through the same
 *  stream because everything downstream of it wants the two in order. */
export type ResizeEvent = { type: 'resize'; cols: number; rows: number }

export type InputEvent = KeyEvent | MouseEvent | FocusEvent | PasteEvent | ResizeEvent

/** Everything a listener is handed. */
export type InputListener = (event: InputEvent) => void
