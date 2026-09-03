import { createParser, type Parser } from './parser'
import type { InputEvent, InputListener } from './events'

// Taking the terminal, and giving it back.
//
// Everything a terminal has to be *asked* for is here: the alternate screen, raw mode, the kitty
// keyboard protocol, SGR mouse reporting, DEC 1004 focus reporting and bracketed paste. It is here
// rather than beside the cell buffer because a request has a reply and the reply arrives as bytes on
// stdin, so whoever asks the question has to be the one reading the answer — `../paint/screen.ts`
// deliberately writes cells and nothing else.
//
// **The two halves compose rather than nest.** This module owns the modes and the reading; the screen
// owns the cells. A boot is:
//
//     const terminal = openTerminal()
//     const { cols, rows } = terminal.size()
//     const screen = openScreen({ cols, rows, write: terminal.write })
//     terminal.on((event) => { if (event.type === 'resize') screen.resize(event.cols, event.rows) })
//
// and a shutdown is `screen.close()` then `terminal.close()`, in that order, so the last frame is
// written while the alternate screen is still ours. Nothing in this slice does that wiring: the
// dispatcher is phase 3 and the switch that boots either painter is the next slice.
//
// **Every request is popped on the way out, in the reverse order.** A process that leaves mouse
// reporting on hands the reader a shell that prints `<35;80;24M` when they move the mouse, and one
// that leaves the alternate screen on hands them a blank prompt. The pops are unconditional because a
// terminal that never took the mode ignores the pop as well.

const CSI = '\x1b['

/**
 * What we ask the kitty keyboard protocol for: disambiguate (1), report event types (2), report
 * alternate keys (4).
 *
 * 1 is the one that matters and it is why the app asks at all: a legacy terminal sends the single
 * byte `\r` for Return with Ctrl held and for Return without it, so `ctrl+return` — `commit`, the key
 * that sends what is in the composer — does not exist to be bound. It settles a lone Escape the same
 * way (docs/tui.md § The adapter).
 *
 * 2 is an addition to what `../main.tsx` asks for today, and it is deliberate. OpenTUI's
 * `useKittyKeyboard: { disambiguate: true }` builds the flags 1 and 4 and never 2 (its
 * `buildKittyKeyboardFlags` at 0.5.9), so no terminal has ever sent this app a key release, and a
 * `release` in our event shape would be a case that cannot happen. Asking for 2 is what makes the
 * third value of `KeyAction` real.
 *
 * 8, report all keys as escape codes, is not asked for: it would route every letter through `CSI u`
 * and leave us decoding text we currently get as text, for the benefit of knowing that somebody let
 * go of `j`. 16, report associated text, only applies with 8.
 */
const KITTY_FLAGS = 1 | 2 | 4

/** The requests, in the order they are made. */
const ENTER = [
  // The alternate screen first, so nothing below is drawn over the reader's scrollback.
  `${CSI}?1049h`,
  // No cursor. There is nothing for it to sit on until phase 3 draws a field, and left visible it
  // parks wherever the last run of the frame ended.
  `${CSI}?25l`,
  // A paste arrives bracketed, so a hundred lines are one event rather than a hundred Returns.
  `${CSI}?2004h`,
  // Mouse: press and release (1000), motion while a button is held (1002), and SGR coordinates
  // (1006) because the old encoding cannot count past column 223. Not 1003, any-motion, which is a
  // report per cell the pointer crosses and nothing here wants hover.
  `${CSI}?1000h`,
  `${CSI}?1002h`,
  `${CSI}?1006h`,
  // Focus reporting, which is the difference between a notice that lands read and one that raises a
  // banner (./events.ts § FocusEvent).
  `${CSI}?1004h`,
  // Push our keyboard flags rather than set them, so a program we hand the terminal to — an editor in
  // a rectangle — can push its own and popping ours restores what was there before.
  `${CSI}>${KITTY_FLAGS}u`,
  // And ask what it agreed to. The reply is `CSI ? <flags> u` and it is the only capability question
  // this client asks; a terminal that does not know the protocol says nothing, which is the answer.
  `${CSI}?u`,
].join('')

/** The same list undone, last first. */
const LEAVE = [
  `${CSI}<u`,
  `${CSI}?1004l`,
  `${CSI}?1006l`,
  `${CSI}?1002l`,
  `${CSI}?1000l`,
  `${CSI}?2004l`,
  // Our own colours off before the cursor comes back, so a shell prompt drawn a moment later is not
  // bold red (../paint/flush.ts § RESET).
  `${CSI}0m`,
  `${CSI}?25h`,
  `${CSI}?1049l`,
].join('')

/** The 80 by 24 every terminal has been since the VT100, for a stdout that will not say. Also the
 *  size the whole kit is designed against (docs/ui-design.md § Every node at 80 by 24). */
const FALLBACK = { cols: 80, rows: 24 }

/** What this module needs of stdin, which is little enough that a test can pass an `EventEmitter`. */
export type TerminalInput = {
  on: (event: 'data', listener: (chunk: Uint8Array) => void) => unknown
  off?: (event: 'data', listener: (chunk: Uint8Array) => void) => unknown
  setRawMode?: (mode: boolean) => unknown
  resume?: () => unknown
  pause?: () => unknown
  isTTY?: boolean
}

/** And of stdout. `write` is what the paint pass is handed. */
export type TerminalOutput = {
  write: (text: string) => unknown
  columns?: number
  rows?: number
}

export type Terminal = {
  /** The terminal's size now. A function rather than two numbers, because a number read at boot is
   *  wrong the moment somebody drags the window and the resize event carries the new pair. */
  size: () => { cols: number; rows: number }
  /** Where a frame goes. Handed straight to `openScreen`. */
  write: (text: string) => void
  /** Listen. Returns the way to stop. */
  on: (listener: InputListener) => () => void
  /** Did this terminal answer the kitty request? */
  kittyAnswered: () => boolean
  /** Give the terminal back: pop every mode, leave raw mode, stop reading. */
  close: () => void
}

export type TerminalOptions = {
  stdin?: TerminalInput
  stdout?: TerminalOutput
  /** Passed through to the parser's lone-ESC wait. */
  timeoutMs?: number
}

export function openTerminal(options: TerminalOptions = {}): Terminal {
  const stdin = options.stdin ?? (process.stdin as unknown as TerminalInput)
  const stdout = options.stdout ?? (process.stdout as unknown as TerminalOutput)

  const listeners = new Set<InputListener>()
  const emit = (event: InputEvent): void => {
    for (const listener of listeners) listener(event)
  }

  const parser: Parser = createParser(emit, { timeoutMs: options.timeoutMs })

  const size = (): { cols: number; rows: number } => ({
    cols: stdout.columns ?? FALLBACK.cols,
    rows: stdout.rows ?? FALLBACK.rows,
  })

  const write = (text: string): void => {
    stdout.write(text)
  }

  const onData = (chunk: Uint8Array): void => {
    parser.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
  }

  // A resize is not a byte sequence, and it goes through the same stream because everything
  // downstream wants a resize and the keys around it in the order they happened.
  const onResize = (): void => {
    const next = size()
    emit({ type: 'resize', cols: next.cols, rows: next.rows })
  }

  write(ENTER)
  // Raw mode is what makes the bytes above ours: no line buffering, no echo, and no terminal driver
  // turning Ctrl+C into a signal before we see it. Ctrl+C at the shell is the TUI's and inside an
  // entered rectangle it is the child's, which is the whole reason a rectangle owns its keys
  // (docs/tui.md § Signals and exit).
  stdin.setRawMode?.(true)
  stdin.resume?.()
  stdin.on('data', onData)
  process.on('SIGWINCH', onResize)

  let open = true

  return {
    size,
    write,
    on: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    kittyAnswered: parser.kittyAnswered,
    close: () => {
      if (!open) return
      open = false
      process.off('SIGWINCH', onResize)
      stdin.off?.('data', onData)
      stdin.setRawMode?.(false)
      stdin.pause?.()
      parser.close()
      listeners.clear()
      write(LEAVE)
    },
  }
}
