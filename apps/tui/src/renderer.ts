import { EventEmitter } from 'node:events'
import { openScreen, type Screen, type Sink } from './paint/screen'
import { onFrame } from './tree/frames'
import { pressAt, wheelAt } from './tree/hit'
import { openTerminal } from './input/terminal'
import type { InputListener } from './input/events'
import { keyPressed } from './keyEvent'
import type { Renderable } from './tree/compat'

// A handle on our screen, so the keyboard can be installed on it.
//
// The three files that take a renderer — `./keys/install.ts`, `./keys/regions.ts` and
// `./keys/keymapHost.ts` — want five things from it: a root to hang a mouse handler on, a `frame`
// event, a key stream, whether it is destroyed, and a `destroy` event. This answers those five over
// `./paint/screen.ts` and nothing else.
//
// It is deliberately no bigger than that. A renderer here has no console to quieten, no keyboard
// capabilities to report — the keymap metadata states those outright — no listener cap, and no idea
// of its own about which node has focus, which is the region store's one value
// (./keys/regions.ts § The one owner).
//
// **It composes the two halves rather than owning either.** `./paint/screen.ts` owns the cells and
// `./input/terminal.ts` owns the modes and the bytes; this holds a screen and, where a caller gave it
// one, a terminal to close after the screen so the last frame lands while the alternate screen is
// still ours (./input/terminal.ts § The two halves compose).
//
// **The key stream is a queue, not a parser.** `keyInput` is an emitter a caller pushes a `KeyEvent`
// onto: the harness pushes one it constructed, and a caller that handed us a terminal gets the ones
// `./input/parser.ts` read off stdin (§ listen). Which of the two the engine is reading is a question
// nothing downstream can ask, and that is the point — a suite driving a different keyboard from the
// app would be testing a different keyboard.

export type Renderer = {
  /** Our screen, for the callers that want cells rather than a renderer. */
  screen: Screen
  root: Renderable
  keyInput: EventEmitter
  isDestroyed: boolean
  on: (event: string, listener: (...args: never[]) => void) => void
  off: (event: string, listener: (...args: never[]) => void) => void
  once: (event: string, listener: (...args: never[]) => void) => void
  /** One wheel step at a cell: the innermost viewport under the pointer moves its offset and the keys
   *  stay where they are (./tree/hit.ts § wheelAt). */
  mouseScroll: (x: number, y: number, direction: 'up' | 'down') => void
  /** One left press at a cell: the stop it landed on is pressed and the nearest thing above it that
   *  can hold the keys takes them. The other and last thing done with the pointer, because focusing
   *  and pressing is the whole of this host's pointer model
   *  (./keys/regions.ts § Clicks are hit tests, docs/tui.md § What the TUI never does). */
  mousePress: (x: number, y: number) => void
  /** Draw now rather than on the next turn of the event loop, which is what a test wants. */
  frame: () => void
  destroy: () => void
}

export function openRenderer(options: {
  cols: number
  rows: number
  write?: Sink
  /** Given the terminal, this closes it after the screen (see the header). */
  closeTerminal?: () => void
  /** Given the terminal, this is how to hear it: everything the parser read, in the order it
   *  happened. Absent in both harnesses, which construct their events instead (§ route). */
  listen?: (listener: InputListener) => () => void
}): Renderer {
  const events = new EventEmitter()
  const keyInput = new EventEmitter()
  const screen = openScreen({
    cols: options.cols,
    rows: options.rows,
    ...(options.write ? { write: options.write } : {}),
  })
  let destroyed = false

  // `frame` is the event the store's reveal waits for, and it has to fire on the side of layout where
  // a child's geometry is real. Here that is after the frame, because a frame is layout and paint in
  // one function — which is what makes one reveal enough under this painter and two necessary under
  // the other (./keys/regions.ts § The reveal).
  //
  // Registered over the screen's own subscriber rather than beside it: `./tree/frames.ts` holds one,
  // because there is one painter, and `screen.close()` still clears it.
  const frame = (): void => {
    if (destroyed) return
    screen.frame()
    events.emit('frame')
  }
  onFrame(frame)

  // ── route ──
  //
  // Everything the terminal says, delivered where this app already listens for it. Five kinds of
  // event and five destinations, and not one of them is new machinery: the parser turns bytes into
  // events and this is the only function that holds both it and the screen.
  //
  // **A key is routed by its action, and getting that wrong fires every binding twice.** Our enter
  // sequence asks the kitty protocol for event reporting, flag 2, which `./main.tsx` has never asked
  // for — OpenTUI's `useKittyKeyboard: { disambiguate: true }` builds flags 1 and 4 and never 2 — so
  // on a terminal that speaks the protocol every key now arrives twice, once as a press and once as
  // a release. So `keypress` carries presses and repeats and `keyrelease` carries releases, which is
  // the split the keymap host's two subscriptions already expect and the split the typing hand-off
  // needs: it listens on `keypress` alone, and a release delivered there would type every character
  // twice (./keys/keymapHost.ts § tuiKeymapHost, ./input/terminal.ts § KITTY_FLAGS).
  const route = (event: Parameters<InputListener>[0]): void => {
    if (event.type === 'resize') { screen.resize(event.cols, event.rows); return }
    if (event.type === 'key') {
      keyInput.emit(event.action === 'release' ? 'keyrelease' : 'keypress', keyPressed(event))
      return
    }
    // A paste is one event rather than a run of Returns, and the dispatcher hands it to whatever has
    // the keys (./keys/install.ts § pasteInto).
    if (event.type === 'paste') { keyInput.emit('paste', event); return }
    // Whether this terminal is the window the reader is looking at, under the two names OpenTUI's
    // renderer raised it by, because `./main.tsx` subscribes to those and it is the same fact
    // (./main.tsx § setHostFocused).
    if (event.type === 'focus') { events.emit(event.state === 'in' ? 'focus' : 'blur'); return }
    // And the pointer, which is two gestures and no more: a wheel moves the viewport under it, and a
    // left press moves the keys.
    if (event.action === 'wheel' && (event.wheel === 'up' || event.wheel === 'down')) {
      wheelAt(screen.root, event.x, event.y, event.wheel)
      return
    }
    if (event.action === 'press' && event.button === 'left') pressAt(screen.root, event.x, event.y)
  }
  const deafen = options.listen?.(route)

  return {
    screen,
    root: screen.root,
    keyInput,
    get isDestroyed() { return destroyed },
    on: (event, listener) => { events.on(event, listener as (...args: unknown[]) => void) },
    off: (event, listener) => { events.off(event, listener as (...args: unknown[]) => void) },
    once: (event, listener) => { events.once(event, listener as (...args: unknown[]) => void) },
    mouseScroll: (x, y, direction) => { wheelAt(screen.root, x, y, direction) },
    mousePress: (x, y) => { pressAt(screen.root, x, y) },
    frame,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      deafen?.()
      screen.close()
      options.closeTerminal?.()
      events.emit('destroy')
      events.removeAllListeners()
      keyInput.removeAllListeners()
    },
  }
}

/**
 * The whole boot: take the terminal, open a screen on it, and follow a resize.
 *
 * Here rather than in `./main.tsx` so the composition root asks for a renderer in one line rather
 * than carrying a boot sequence of its own. The two halves it composes are `./input/terminal.ts` and
 * `./paint/screen.ts`, and the order matters on the way out (see the header).
 */
export function openTerminalRenderer(): Renderer {
  const terminal = openTerminal()
  return openRenderer({
    ...terminal.size(),
    write: terminal.write,
    closeTerminal: terminal.close,
    listen: terminal.on,
  })
}
