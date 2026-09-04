/** @jsxImportSource @acorn/tui/jsx */
import { createRequire } from 'node:module'
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import type { Renderable } from '../tree/compat'
import type { KeyEvent } from '../keyEvent'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import { keymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { focusRenderable, focusWithin, focusedRenderable, onScreen } from '../keys/regions'
import { RECTANGLE } from '../keys/tiers'
import { holdFrame, requestFrame } from '../tree/frames'
import type { Node } from '../tree/node'
import { Line } from './cells'
import { encodeKey, encodePaste, type PtyModes } from './ptyKeys'
import { boxBorder } from './roles'

// The PTY, natively, and the keyboard contract that makes a rectangle a rectangle.
//
// This is the one thing a terminal does better than the desktop. The desktop draws a terminal by
// running a terminal emulator written in JavaScript inside a browser inside an app; here the emulator
// draws in cells, and the PTY's bytes go straight into it. The PTY itself does not move: it stays on
// the node, reached over the same `term` WebSocket channel
// (docs/terminal-and-agents.md), and this is a second emulator for it.
//
// **The emulator is `@xterm/headless`**, which three other packages in this repo already depend on
// and which the desktop draws the same PTY through — so a program's output is parsed by the same
// parser on both hosts and looks the same. The one thing headless xterm has no notion of is a
// keyboard, hence `./ptyKeys.ts`. Everything above the emulator — the arming, the intercept, the
// Escape pair, the footer's answer — is the rectangle contract and knows nothing about it
// (docs/tui.md § The Rectangle contract).

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

/** What the rectangle asks of the emulator inside it, installed once the emulator is mounted. Two
 *  answers, because everything else a rectangle does it does above the emulator. */
type Inside = {
  /** The bytes this keystroke sends the program, honouring whatever modes it has set. */
  encode: (key: KeyEvent) => Uint8Array
  /** The bytes this paste sends it, bracketed where the program asked for that
   *  (../keys/install.ts § pasteInto). */
  paste: (text: string) => Uint8Array
}

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
// Every mounted rectangle's own answer, rather than a count of the ones that are entered. Two of them
// can be mounted at once, a task with a terminal pane beside a docker exec, and each answers about its
// own box, so the footer asks whether any of them says yes. A count could disagree with the screen and
// did: the second rectangle leaving decremented a number the first one still held, and a rectangle
// hidden without being unmounted never decremented at all, so the footer went on telling a reader to
// press Escape at a box nobody could see. Nothing derived from the box itself can drift that way.
//
// A signal over the list rather than a plain array, so the footer re-reads when a rectangle mounts as
// well as when one is entered. Module state rather than a prop threaded up through the shell: the
// footer is drawn by the chrome and the rectangle is drawn by a pane, and there is no path between
// them.
const [live, setLive] = createSignal<readonly (() => boolean)[]>([])

/** Is a rectangle holding every key right now? Read by the footer, which says so and says how to get
 *  back out (docs/tui.md § The footer). */
export const enteredRectangle = (): boolean => live().some((held) => held())

// ── The emulator under our painter ────────────────────────────────────────────────────────────

/** How much scrollback the emulator keeps. The kit exposes no way to scroll a rectangle — its
 *  viewport is the box — so this is for the program inside, which scrolls its own region and expects
 *  the rows above to still be there. `less` on a long file is the case. */
const SCROLLBACK = 1000

/** The `Terminal` class, loaded the first time a rectangle under our painter is drawn.
 *
 *  Through `createRequire` because `@xterm/headless` ships one CommonJS bundle whose named exports
 *  Node's ESM loader cannot see, which is the shape
 *  `plugins/agents/src/server/usage/processRunner.ts` already uses for it. Lazily, and that half is
 *  load-bearing: this module is in `App`'s eager graph, so a static import would put a whole terminal
 *  emulator into the startup of the build that draws its terminals with OpenTUI's instead
 *  (../scripts/check-startup-graph.mjs, docs/frontend.md § Startup budget). */
let loaded: typeof HeadlessTerminal | undefined

const emulatorClass = (): typeof HeadlessTerminal => {
  loaded ??= (createRequire(import.meta.url)('@xterm/headless') as {
    Terminal: typeof HeadlessTerminal
  }).Terminal
  return loaded
}

/** The modes the encoder needs, read off the emulator at the moment a key arrives rather than
 *  remembered anywhere: the program inside is the only thing that sets them and it is free to set one
 *  between two keystrokes (./ptyKeys.ts § The mode table). */
const modesOf = (term: HeadlessTerminal): PtyModes => ({
  applicationCursor: term.modes.applicationCursorKeysMode,
  bracketedPaste: term.modes.bracketedPasteMode,
})

/**
 * A `pty` rectangle: an emulator in cells, one tab stop from outside.
 *
 * Enter hands the keys to what is in the box, Escape takes them back, and while the box has them
 * every key belongs to it — `Ctrl+C` included, which is the whole point and the reason no app layer
 * may fire while a rectangle is entered.
 */
export function PtyRectangle(props: { label: string; hidden?: boolean; mount?: (terminal: CellTerminal) => void }) {
  // Enter was pressed and nothing has taken the keys off the box since. Half of the answer, and the
  // only half worth storing: the other half is the box's own focus, which the store owns
  // (§ entered).
  const [armed, setArmed] = createSignal(false)
  let box: Renderable | undefined
  let inside: Inside | undefined
  let leftAt = 0
  const dataListeners: ((bytes: Uint8Array) => void)[] = []
  const sizeListeners: ((cols: number, rows: number) => void)[] = []

  const emit = (bytes: Uint8Array) => {
    for (const listener of dataListeners) listener(bytes)
  }
  // A keystroke, encoded the way a PTY expects it, and handed to whoever is filling the rectangle.
  // Through an encoder rather than the emulator's own key handling: OpenTUI's only takes keys when
  // the renderer has focused it, headless xterm has no keyboard at all, and here the box holds the
  // focus either way so that Enter and Escape belong to the rectangle rather than to what is in it.
  const send = (key: KeyEvent) => {
    const bytes = inside?.encode(key)
    if (bytes?.length) emit(bytes)
  }

  // Whether the keys are this rectangle's, as a fact about the screen rather than a flag anybody
  // maintains: the reader pressed Enter since the box last lost the keys, the box has them, and the
  // box is on screen. Asking the store is what makes a rectangle hidden without being unmounted stop
  // eating keys, because `visible` is per node and `onScreen` walks the parents
  // (../keys/regions.ts § onScreen).
  //
  // Both terms are reactive now and both have to be, because this answer is drawn: the title and the
  // border tone are this box's own, so a render that short-circuited before either signal would not
  // re-run when the keys arrived, and the rectangle would take them without saying so.
  const entered = (): boolean => armed() && !!box && focusedRenderable() === box && onScreen(box)

  const enter = () => setArmed(true)
  const leave = () => {
    if (!armed()) return
    setArmed(false)
    leftAt = Date.now()
    // Back on the door, through the store's one door, so the region the rectangle is in sees the keys
    // come back to it (../keys/regions.ts § The one owner).
    focusRenderable(box)
  }
  // The keys leaving the box disarms it, and there are two ways for that to happen: something else
  // takes them, or the box goes off screen behind an overlay or a switched-away tab. Neither used to
  // be one thing to watch — the first raised the renderer's `blurred` event and the second raised
  // nothing at all — and one store's signal is both of them now. Hiding a subtree asks for a landing
  // pass, the pass moves the keys off the node that went off screen, and that write is this effect's
  // turn to run (../keys/regions.ts § The landing rule).
  createEffect(() => {
    if (armed() && !entered()) setArmed(false)
  })
  // A rectangle unmounted while entered — a pane closed with Ctrl+C still in flight — must not leave
  // the footer telling a reader to press Escape at nothing.
  setLive((all) => [...all, entered])
  onCleanup(() => setLive((all) => all.filter((held) => held !== entered)))

  /** A size the emulator has taken, passed on to whoever opened the channel. */
  const resized = (cols: number, rows: number): void => {
    for (const listener of sizeListeners) listener(cols, rows)
  }

  /** The handle a caller filling the rectangle is given: the emulator's own write and size, and this
   *  component's two listener lists. The same four members whichever emulator mounted, which is what
   *  keeps `./pty.ts` one piece of code (§ CellTerminal). */
  const hand = (write: CellTerminal['write'], size: CellTerminal['size']): void => {
    props.mount?.({
      write,
      size,
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
    })
  }

  /**
   * The emulator, held by the component and read by paint.
   *
   * The `Terminal` goes on the node as a prop, which is the one widget in this kit whose state does
   * not reduce to numbers — paint has to read a buffer. It is still the component's: the node holds a
   * reference and knows nothing about it, so there is no emulator state the node can be in that this
   * component disagrees with (../paint/paint.ts § drawPty).
   */
  const handedOwn = (element: unknown) => {
    const node = element as Node
    const Emulator = emulatorClass()
    // Before the first layout the rectangle is nought by nought and a `Terminal` refuses either
    // dimension at nought, so the first size is a floor and the first `onSizeChange` is what makes it
    // real.
    const term = new Emulator({
      cols: Math.max(1, node.rect.w),
      rows: Math.max(1, node.rect.h),
      scrollback: SCROLLBACK,
      // `buffer` is behind this flag in 5.5.0 — `_checkProposedApi` throws on the getter without it —
      // and the buffer is the whole of what paint reads. "Proposed" here means the shape may change
      // in a major version rather than that it is unfinished: `apps/desktop` and `plugins/agents`
      // both read the same buffer through it, and this pins the same 5.5.0 they do
      // (../paint/paint.ts § drawPty).
      allowProposedApi: true,
    })
    onCleanup(() => term.dispose())
    node.props.terminal = term
    // The emulator answering a query the program inside sent it, exactly as above. It is the only
    // thing this event carries here, because nothing calls `term.input`: a rectangle decides which
    // keys are its before the emulator sees one.
    const replies = term.onData((text) => emit(new TextEncoder().encode(text)))
    onCleanup(() => replies.dispose())
    inside = {
      encode: (key) => encodeKey(key, modesOf(term)),
      paste: (text) => encodePaste(text, modesOf(term)),
    }
    node.props.onSizeChange = () => {
      const cols = node.rect.w
      const rows = node.rect.h
      // A hidden rectangle lays out at nought by nought, and telling a full-screen program that its
      // window is empty would have it redraw at that size the moment the tab came back
      // (../keys/keys.test.tsx § stops taking the keys the moment an entered rectangle goes off
      // screen).
      if (cols <= 0 || rows <= 0) return
      if (cols === term.cols && rows === term.rows) return
      term.resize(cols, rows)
      resized(cols, rows)
    }
    // Whether paint draws the emulator's own caret, which is exactly whether the rectangle is
    // entered. Written from an effect rather than spelled as a JSX attribute, the way every other
    // widget's props are while the switch exists: tsc types every intrinsic in this package against
    // OpenTUI's prop shapes whichever painter the build picked
    // (./scrolling.tsx § ownViewport, ../paint/paint.ts § drawPty).
    createEffect(() => {
      node.props.focused = entered()
      requestFrame()
    })
    // A write is the one thing in this tree that produces cells later rather than now: xterm parses
    // on a queue of its own, a macrotask after the call returns. So the frame is *held* rather than
    // asked for, and the emulator's own callback is what lets go — without which a harness that draws
    // as soon as nothing is asking draws the screen from before the output
    // (../tree/frames.ts § holdFrame).
    const write = (data: string | Uint8Array): void => {
      term.write(data, holdFrame())
    }
    hand(write, () => ({ cols: node.rect.w, rows: node.rect.h }))
  }

  const engine = keymap<Renderable, KeyEvent>()
  if (engine) {
    // At the `RECTANGLE` tier, above every layer there is: while a rectangle is entered the keys are
    // its, `Ctrl+C` included, and no app layer may fire. An intercept rather than a layer, because a
    // layer answers the keys it can name and a rectangle answers all of them
    // (docs/tui.md § The Rectangle contract, ../keys/tiers.ts).
    onCleanup(engine.intercept('key', (ctx) => {
      const key = ctx.event
      if (!entered()) {
        // One stop from outside: the box holds the focus, not what is in it. Enter goes in, and a
        // second Escape just after leaving goes back in and sends the Escape through, which is how a
        // reader reaches vim's normal mode from in here.
        if (!focusWithin(box)) return
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
    }, { priority: RECTANGLE }))
  }

  /** A paste while the rectangle is entered belongs to the program inside it, bracketed where that
   *  program asked for it. The same member a field installs and the same route the dispatcher hands
   *  one down, because "what has the keys" is one question and the box is what has them
   *  (../keys/install.ts § pasteInto, ./asking.tsx § api). */
  const pasted = (event: { text: string }): void => {
    if (!entered()) return
    const bytes = inside?.paste(event.text)
    if (bytes?.length) emit(bytes)
  }

  return (
    <box
      ref={(element: Renderable) => {
        box = element
        element.focusable = true
        ;(element as unknown as { handlePaste?: (event: { text: string }) => void }).handlePaste = pasted
      }}
      flexDirection="column"
      flexGrow={1}
      // Kept mounted and taken off the screen, which is what a tab strip over several of these asks
      // for: the emulator and its channel survive the switch (docs/terminal.md § Client). `entered`
      // above already asks the screen rather than a flag, so a box hidden this way stops taking the
      // keys without anything else being told.
      visible={!props.hidden}
      // The same border either way, and the title carries the state instead. A `control` border is a
      // different role, not a brighter one, and a style pack may set any role to zero width — so
      // swapping roles to mean "focused" is how a box quietly stops being drawn at all
      // (docs/ui-design.md § Borders).
      {...boxBorder('surface', { tone: entered() ? 'accent' : 'neutral' })}
      // Short, because a box title that does not fit its width is not drawn at all. The whole rule —
      // "esc leave · esc esc send escape" — is on the footer, which says it while a rectangle is
      // entered (../chrome/Footer.tsx).
      title={`${props.label} · ${entered() ? 'esc leave' : 'enter'}`}
    >
      {/* Not a stop: the box is, and the emulator is what is inside it, so focus lands on the box
          and the box decides when to hand the keys over. A `pty` is not focusable by default, so
          nothing here has to say so (../tree/compat.ts § focusable). */}
      <pty ref={handedOwn} flexGrow={1} />
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
