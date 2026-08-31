/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, Show, type JSX } from 'solid-js'
import { extend } from '@opentui/solid'
import { EmbeddedTerminalRenderable, type BoxRenderable, type KeyEvent, type Renderable } from '@opentui/core'
import { keymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { Line } from './cells'
import { boxBorder } from './roles'

// The PTY, natively, and the keyboard contract that makes a rectangle a rectangle.
//
// This is the one thing a terminal does better than the desktop. The desktop draws a terminal by
// running a terminal emulator written in JavaScript inside a browser inside an app; here the emulator
// is OpenTUI's, in cells, and the PTY's bytes go straight into it. The PTY itself does not move: it
// stays on the node, reached over the same `term` WebSocket channel
// (docs/terminal-and-agents.md), and this is a second emulator for it.
//
// `EmbeddedTerminalRenderable` is not one of OpenTUI's Solid intrinsics, so the catalogue is extended
// once with it. `extend` is idempotent enough to call at module scope: the catalogue is a plain
// record and this writes the same entry every time.
extend({ embedded_terminal: EmbeddedTerminalRenderable })

/**
 * What a caller filling a `pty` rectangle is handed.
 *
 * The DOM hands over an element and the caller attaches xterm to it. There is no element here, so the
 * host hands over the three operations a terminal is: bytes in, keystrokes out, and the size of the
 * box in cells (docs/tui.md § Rectangles).
 */
export type CellTerminal = {
  /** Bytes from the PTY, written into the emulator. */
  write: (data: string | Uint8Array) => void
  /** Keystrokes the reader typed, already encoded the way a PTY expects them. */
  onData: (listener: (bytes: Uint8Array) => void) => void
  /** The region's size in cells, whenever it changes. A terminal resize is the renderer's alone: it
   *  handles `SIGWINCH` itself, re-lays out, and this is how that reaches the PTY. */
  onResize: (listener: (cols: number, rows: number) => void) => void
  /** The region's size in cells right now, for a caller that has to open its channel at a size before
   *  the first resize arrives. `onResize` alone would leave a PTY guessing until the reader dragged
   *  something (./pty.ts). */
  size: () => { cols: number; rows: number }
}

// Above every layer there is: while a rectangle is entered the keys are its, `Ctrl+C` included, and
// no app layer may fire. An intercept rather than a layer, because a layer answers keys it can name
// and a rectangle answers all of them (docs/tui.md § The Rectangle contract).
const RECTANGLE_PRIORITY = 200

// How long after leaving a rectangle a second Escape means "send an Escape to what is inside".
//
// The contract is "Escape alone leaves, Escape twice sends one"
// (docs/tui.md § The Rectangle contract). Leaving on the first press
// and treating a second press as re-enter-and-send is the same behaviour with no latency: holding the
// first Escape for a window to see whether a second arrives would make every exit feel slow, and this
// is the one key rule the desktop does not have, so it should not also be the slowest.
const ESCAPE_PAIR_MS = 400

// Whether any rectangle has the keys, for the footer.
//
// A count rather than a boolean, because two rectangles can be mounted at once — a task with a
// terminal pane and a docker exec — and the second one leaving must not clear a flag the first one
// still holds. Module state rather than a prop threaded up through the shell: the footer is drawn by
// the chrome and the rectangle is drawn by a pane, and there is no path between them.
const [entered, setEntered] = createSignal(0)

/** Is a rectangle holding every key right now? Read by the footer, which says so and says how to get
 *  back out (docs/tui.md § The footer). */
export const enteredRectangle = (): boolean => entered() > 0

/**
 * A `pty` rectangle: an emulator in cells, one tab stop from outside.
 *
 * Enter hands the keys to what is in the box, Escape takes them back, and while the box has them
 * every key belongs to it — `Ctrl+C` included, which is the whole point and the reason no app layer
 * may fire while a rectangle is entered.
 */
export function PtyRectangle(props: { label: string; mount?: (terminal: CellTerminal) => void }) {
  const [inside, setInside] = createSignal(false)
  let box: BoxRenderable | undefined
  let term: EmbeddedTerminalRenderable | undefined
  let leftAt = 0
  const dataListeners: ((bytes: Uint8Array) => void)[] = []
  const sizeListeners: ((cols: number, rows: number) => void)[] = []

  const emit = (bytes: Uint8Array) => {
    for (const listener of dataListeners) listener(bytes)
  }
  // A keystroke, encoded the way a PTY expects it, and handed to whoever is filling the rectangle.
  // Through `encodeKey` rather than the emulator's own key handling: the emulator only takes keys
  // when the renderer has focused it, and here the box holds the focus so that Enter and Escape
  // belong to the rectangle rather than to what is inside it.
  const send = (key: KeyEvent) => {
    const bytes = term?.encodeKey(key)
    if (bytes?.length) emit(bytes)
  }

  const enter = () => {
    if (inside()) return
    setInside(true)
    setEntered((open) => open + 1)
  }
  const leave = () => {
    if (!inside()) return
    setInside(false)
    setEntered((open) => Math.max(0, open - 1))
    leftAt = Date.now()
    box?.focus()
  }
  // A rectangle unmounted while entered — a pane closed with Ctrl+C still in flight — must not leave
  // the footer telling a reader to press Escape at nothing.
  onCleanup(() => { if (inside()) setEntered((open) => Math.max(0, open - 1)) })

  const handed = (renderable: EmbeddedTerminalRenderable) => {
    term = renderable
    // Not itself a stop. The rectangle is one stop from outside and the emulator is what is inside
    // it, so focus lands on the box and the box decides when to hand the keys over. Leaving the
    // emulator focusable would let a region's first stop land past the door.
    renderable.focusable = false
    // The emulator answering a query the program inside sent it — cursor position, device
    // attributes. It goes to the PTY exactly like a keystroke does, and it is the only thing this
    // callback carries: the keys are forwarded below, because a rectangle decides which keys are its
    // before the emulator ever sees one.
    renderable.onData = (bytes) => emit(bytes)
    renderable.onTerminalResize = (cols, rows) => {
      for (const listener of sizeListeners) listener(cols, rows)
    }
    props.mount?.({
      write: (data) => renderable.write(data),
      onData: (listener) => {
        dataListeners.push(listener)
        onCleanup(() => {
          const at = dataListeners.indexOf(listener)
          if (at >= 0) dataListeners.splice(at, 1)
        })
      },
      onResize: (listener) => {
        sizeListeners.push(listener)
        onCleanup(() => {
          const at = sizeListeners.indexOf(listener)
          if (at >= 0) sizeListeners.splice(at, 1)
        })
      },
      size: () => ({ cols: renderable.width, rows: renderable.height }),
    })
  }

  const engine = keymap<Renderable, KeyEvent>()
  if (engine) {
    onCleanup(engine.intercept('key', (ctx) => {
      const key = ctx.event
      if (!inside()) {
        // One stop from outside: the box holds the focus, not what is in it. Enter goes in, and a
        // second Escape just after leaving goes back in and sends the Escape through, which is how a
        // reader reaches vim's normal mode from in here.
        if (!box || !(box.focused || box.hasFocusedDescendant)) return
        if (key.name === 'return') { enter(); ctx.consume(); return }
        if (key.name === 'escape' && Date.now() - leftAt < ESCAPE_PAIR_MS) {
          enter()
          send(key)
          ctx.consume()
        }
        return
      }
      if (key.name === 'escape') { leave(); ctx.consume(); return }
      send(key)
      ctx.consume()
    }, { priority: RECTANGLE_PRIORITY }))
  }

  return (
    <box
      ref={(element: BoxRenderable) => { box = element; element.focusable = true }}
      flexDirection="column"
      flexGrow={1}
      // The same border either way, and the title carries the state instead. A `control` border is a
      // different role, not a brighter one, and a style pack may set any role to zero width — so
      // swapping roles to mean "focused" is how a box quietly stops being drawn at all
      // (docs/ui-design.md § Borders).
      {...boxBorder('surface', { tone: inside() ? 'accent' : 'neutral' })}
      // Short, because a box title that does not fit its width is not drawn at all. The whole rule —
      // "esc leave · esc esc send escape" — is on the footer, which says it while a rectangle is
      // entered (../chrome/Footer.tsx).
      title={`${props.label} · ${inside() ? 'esc leave' : 'enter'}`}
    >
      <embedded_terminal ref={handed} flexGrow={1} />
    </box>
  )
}

/** An `editor` rectangle: the text of the file, read-only, with the handoff to `$EDITOR` beside it.
 *
 *  A box and a line. The read-only view and the search inside it are not built, and the handoff
 *  needed nothing built: the editor pane's terminal mode runs the reader's own editor in a PTY on the
 *  node, so in cells it simply draws (docs/tui.md § Rectangles).
 *  Drawn rather than absent because a pane that names one is telling the truth about what is there. */
export function EditorRectangle(props: { label: string; children?: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1} {...boxBorder('surface')} title={props.label}>
      <Show when={props.children} fallback={<Line role="muted">the file opens here</Line>}>{props.children}</Show>
    </box>
  )
}
