import { EventEmitter } from 'node:events'
import { openScreen, type Screen, type Sink } from './paint/screen'
import { onFrame } from './tree/frames'
import { pressAt, wheelAt } from './tree/hit'
import { openTerminal } from './input/terminal'
import type { InputListener } from './input/events'
import { keyPressed } from './ownKeys'
import type { Node } from './tree/node'

// A `CliRenderer`-shaped handle on our screen, so the keyboard can be installed on it.
//
// The three files that take a renderer today — `./keys/install.ts`, `./keys/regions.ts` and
// `./keys/keymapHost.ts` — want eight things from it: a root to hang a mouse handler on, a `frame`
// event, a key stream, whether it is destroyed, which renderable it has focused, and a console it can
// quieten. None of that is the Zig half. So this answers those eight names over `./paint/screen.ts`
// and nothing else, and phase 4 deletes it along with the OpenTUI types those files are written
// against (docs/future/terminal-rewrite/phase-2-the-painter.md).
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

export type OwnRenderer = {
  /** Our screen, for the callers that want cells rather than a renderer. */
  screen: Screen
  root: Node
  keyInput: EventEmitter
  /** The keyboard protocol this build asks for, which decides whether the engine reports `super` and
   *  `hyper` as supported (@opentui/keymap § createOpenTuiHostMetadata). Always true: the request is
   *  in `./input/terminal.ts`'s enter sequence. */
  capabilities: { kitty_keyboard: true }
  isDestroyed: boolean
  /** The caret mirror, which is the one thing about focus the store still tells a renderer
   *  (./keys/regions.ts § paintCaret). There is no caret until phase 3 draws a field, so it does
   *  nothing — and there is deliberately no way to ask this object where the keys are, because the
   *  store is the only one that knows (./invariants.test.ts § the store is the only owner). */
  focusRenderable: (node: Node | null) => void
  on: (event: string, listener: (...args: never[]) => void) => void
  off: (event: string, listener: (...args: never[]) => void) => void
  once: (event: string, listener: (...args: never[]) => void) => void
  setMaxListeners: (count: number) => void
  prependInputHandler: (handler: (sequence: string) => boolean) => void
  removeInputHandler: (handler: (sequence: string) => boolean) => void
  /** The overlay that is not there. OpenTUI replaced `global.console` and popped a debug panel over
   *  the frame; we write cells to stdout and nothing else, so there is nothing to hide and nothing
   *  cached (docs/future/terminal-rewrite/architecture.md § 3). */
  console: { hide: () => void; deactivate: () => void; activate: () => void; getCachedLogs: () => string }
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

export function openOwnRenderer(options: {
  cols: number
  rows: number
  write?: Sink
  /** Given the terminal, this closes it after the screen (see the header). */
  closeTerminal?: () => void
  /** Given the terminal, this is how to hear it: everything the parser read, in the order it
   *  happened. Absent in both harnesses, which construct their events instead (§ route). */
  listen?: (listener: InputListener) => () => void
}): OwnRenderer {
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
  // twice (./keys/keymapHost.ts § ownKeymapHost, ./input/terminal.ts § KITTY_FLAGS).
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
    capabilities: { kitty_keyboard: true },
    get isDestroyed() { return destroyed },
    focusRenderable: () => {},
    on: (event, listener) => { events.on(event, listener as (...args: unknown[]) => void) },
    off: (event, listener) => { events.off(event, listener as (...args: unknown[]) => void) },
    once: (event, listener) => { events.once(event, listener as (...args: unknown[]) => void) },
    setMaxListeners: (count) => { events.setMaxListeners(count) },
    prependInputHandler: () => {},
    removeInputHandler: () => {},
    console: { hide: () => {}, deactivate: () => {}, activate: () => {}, getCachedLogs: () => '' },
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
 * The whole boot under our painter: take the terminal, open a screen on it, and follow a resize.
 *
 * Here rather than in `./main.tsx` so that file's own two lines are a choice between two functions
 * rather than a second boot sequence, and so the composition root reaches the new painter through one
 * `import()` — which is what keeps it out of the bundle that does not draw with it (./ownKeys.ts).
 */
export function openOwnSurface(): OwnRenderer {
  const terminal = openTerminal()
  return openOwnRenderer({
    ...terminal.size(),
    write: terminal.write,
    closeTerminal: terminal.close,
    listen: terminal.on,
  })
}
