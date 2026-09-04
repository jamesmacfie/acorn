/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js'
import type { CliRenderer } from '@opentui/core'
import { rgbOf } from '../colourCompat'
import { openOwnRenderer } from '../ownRenderer'
import { frameRequested, framesSettled } from '../tree/frames'
import { pressedKey } from '../ownKeys'

// Drawing one node to a cell buffer, reading it back, and pressing a key at it, which is what a test
// of this kit is.
//
// The DOM kit's tests render to jsdom and query the tree (client-core's `hosts` vitest project). A
// cell host has no tree to query: what a node did is what is in the buffer, so the assertion is the
// characters. That is stricter and it is the point — "`Badge` draws `[text]`" is a claim about the
// screen, and the 80×24 appendix is written in those terms.

export type Frame = {
  /** Every line, trailing spaces trimmed, so an assertion is about what was drawn. */
  lines: string[]
  /** The whole thing, for a `toContain` on something that spans a line break. */
  text: string
}

/** One run of cells: what it says, what colour it says it in, and the attribute bitmask.
 *
 *  A char frame answers what is on the screen and nothing about how it is drawn, and this host's
 *  answer to "this control has focus" is a colour and a weight rather than a character — so without
 *  this the whole of `litControl` would be untested (../harness.tsx has the same pair for the shell). */
export type Run = { text: string; fg: { r: number; g: number; b: number }; attributes: number }

export type Cells = Frame & {
  /** The frame as coloured runs rather than characters. */
  runs: () => Run[]
  /** Read the buffer again after something has moved. */
  frame: () => Promise<Cells>
  /** A single character is itself; a named key is the parser's own spelling for one, which is upper
   *  case — `RETURN`, `ESCAPE`, `PAGEDOWN`. Anything else is typed one letter at a time, silently,
   *  which is a good hour to save the next person (../ownKeys.ts § pressedKey). */
  press: (key: string, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }) => Promise<Cells>
  /** Send one terminal wheel/trackpad step at a cell. */
  scroll: (x: number, y: number, direction: 'up' | 'down') => Promise<Cells>
  /** A bracketed paste, which a terminal delivers whole. Not a run of key presses: the difference
   *  between pasting a hundred lines into a composer and sending it a hundred times
   *  (../input/events.ts § PasteEvent). */
  paste: (text: string) => Promise<Cells>
  /** Press and release the left button at a cell, which is what a reader's click is. */
  click: (x: number, y: number) => Promise<Cells>
  resize: (width: number, height: number) => Promise<Cells>
  /** The renderer, for the questions the store does not answer: the tree a case wants to walk, and
   *  the root a hit test starts from (./kit.test.tsx § every control is a stop). */
  renderer: CliRenderer
  done: () => void
}

/**
 * The renderer, the frame readers, the key queue and the pointer. The same six answers
 * `../harness.tsx § Surface` gives for the whole shell, plus the mouse two, because a kit case clicks
 * and scrolls where a shell case does not.
 */
type Surface = {
  renderer: CliRenderer
  flush: () => Promise<unknown>
  captureCharFrame: () => string
  runs: () => Run[]
  resize: (width: number, height: number) => void
  pressKey: (key: string, modifiers?: Modifiers) => void
  pasteText: (text: string) => void
  scroll: (x: number, y: number, direction: 'up' | 'down') => Promise<void>
  click: (x: number, y: number) => Promise<void>
  destroy: () => void
}

type Modifiers = { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }

const openSurface = (size: { width: number; height: number }): Surface => {
  const renderer = openOwnRenderer({ cols: size.width, rows: size.height })
  return {
    renderer: renderer as unknown as CliRenderer,
    // Turn the event loop until the tree stops asking for frames, then draw once, for the reason
    // `../harness.tsx § openSurface` gives: one frame produces the next, so a fixed number of turns
    // reads a screen that is still settling (../tree/frames.ts).
    flush: async () => {
      for (let turn = 0; turn < 20 && frameRequested(); turn += 1) {
        await new Promise((done) => setImmediate(done))
      }
      // …and then anything that has *held* a frame rather than asked for one, which the loop above
      // cannot outwait: a `pty` rectangle's emulator parses on a timer and twenty turns of
      // `setImmediate` go by in two milliseconds (../tree/frames.ts § framesSettled).
      await framesSettled()
      renderer.frame()
    },
    captureCharFrame: () => `${renderer.screen.lines().join('\n')}\n`,
    runs: () => renderer.screen.runs().flatMap((line) => line.map((run) => ({
      text: run.text,
      fg: rgbOf(run.fg),
      attributes: run.attrs,
    }))),
    resize: (width, height) => {
      renderer.screen.resize(width, height)
      renderer.frame()
    },
    pressKey: (key, modifiers) => { renderer.keyInput.emit('keypress', pressedKey(key, modifiers)) },
    // Onto the same queue the keys arrive on, because that is where the dispatcher's paste hand-off
    // listens (../keys/install.ts § pasteInto).
    pasteText: (text) => { renderer.keyInput.emit('paste', { text }) },
    // The two gestures this host has. A wheel hit-tests to the innermost viewport under the cell
    // and moves its offset; a press hit-tests to the deepest node and walks up, pressing the stop
    // it landed on and giving it the keys (../tree/hit.ts, ../keys/regions.ts § Clicks are hit
    // tests).
    scroll: async (x, y, direction) => { renderer.mouseScroll(x, y, direction) },
    click: async (x, y) => { renderer.mousePress(x, y) },
    destroy: () => renderer.destroy(),
  }
}

/** Render a fragment at a size, with the keymap installed on it. Small by default, because a node
 *  under test is a node and not a screen, and a wide buffer hides a node that overflows its row. */
export async function renderCells(
  node: () => JSX.Element,
  size: { width?: number; height?: number } = {},
): Promise<Cells> {
  const { render } = await import('../tree/renderer')
  const { installKeymap } = await import('../keys/install')
  const { installRenderGuard, RENDERER_LISTENER_CAP } = await import('../renderGuard')
  const { _resetCollections } = await import('../keys/collection')
  const { _resetRegions } = await import('../keys/regions')
  const { _resetLayoutState } = await import('@acorn/client-core/host/layouts/state.ts')
  _resetCollections()
  _resetRegions()
  _resetLayoutState()
  installRenderGuard()

  // The renderer first and the tree second, because a collection, a layout and a trap each register
  // their key layer as they draw and a layer registered against no engine is silently dropped.
  const setup = openSurface({ width: size.width ?? 40, height: size.height ?? 8 })
  setup.renderer.setMaxListeners(RENDERER_LISTENER_CAP)
  installKeymap(setup.renderer)
  // The tree mounts on the screen's root node rather than on the surface around it
  // (../tree/renderer.ts § render).
  const mounted = await render(node, (setup.renderer as unknown as { root: unknown }).root as never)
  // The Solid root as well as the surface: `render` hands the disposer back and leaves the lifetime
  // to the caller, and a tree left mounted re-runs its effects against a torn-down keymap
  // (../harness.tsx § previous).
  const tearDown = (): void => {
    ;(mounted as unknown as () => void)()
    setup.destroy()
  }
  // Bounded, and the frame is taken either way: a tree that never settles is itself a finding, and a
  // capture that hangs says nothing about which node did it.
  const settle = (ms: number) => Promise.race([setup.flush(), new Promise((done) => setTimeout(done, ms))])
  await settle(2000)

  const read = (): Cells => {
    const raw = setup.captureCharFrame()
    return {
      lines: raw.split('\n').map((line) => line.replace(/\s+$/, '')),
      text: raw,
      runs: () => setup.runs(),
      frame,
      press,
      scroll,
      click,
      paste,
      resize,
      renderer: setup.renderer,
      done: tearDown,
    }
  }
  const frame = async (): Promise<Cells> => {
    await settle(500)
    return read()
  }
  // No wait between the press and the frame. A test constructs the event and pushes it onto the key
  // stream, so there is no byte parser in front of the dispatcher to hold a lone Escape while it
  // waits to see whether a sequence follows — the wait that used to be here was for one
  // (../input/parser.ts, ../ownKeys.ts § pressedKey).
  const press = async (
    key: string,
    modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean },
  ): Promise<Cells> => {
    setup.pressKey(key, modifiers)
    return frame()
  }
  const scroll = async (x: number, y: number, direction: 'up' | 'down'): Promise<Cells> => {
    await setup.scroll(x, y, direction)
    return frame()
  }
  const paste = async (text: string): Promise<Cells> => {
    setup.pasteText(text)
    return frame()
  }
  const click = async (x: number, y: number): Promise<Cells> => {
    await setup.click(x, y)
    return frame()
  }
  const resize = async (width: number, height: number): Promise<Cells> => {
    setup.resize(width, height)
    return frame()
  }
  return read()
}
