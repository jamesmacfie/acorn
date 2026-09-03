/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js'
import type { CliRenderer } from '@opentui/core'
import { rgbOf } from '../colourCompat'
import { openOwnRenderer } from '../ownRenderer'
import { frameRequested, framesSettled } from '../tree/frames'
import { pressedKey } from '../ownKeys'
import { drawsOwn } from '../painter'

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

/** One run of cells: what it says, what colour it says it in, and OpenTUI's attribute bitmask.
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
  /** A single character is itself; a named key is OpenTUI's own spelling for one, which is upper case
   *  (`KeyCodes.RETURN`, `KeyCodes.ESCAPE`). Anything else is typed one letter at a time, silently,
   *  which is a good hour to save the next person. */
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
  /** The renderer, for the one question the store does not answer: which renderable OpenTUI is
   *  drawing the caret on. A case asserts that typing reaches a field the store has given the keys
   *  to whatever the renderer thinks, which is the whole of the focus model in one line
   *  (./kit.test.tsx § typing does not go through the renderer's focus). */
  renderer: CliRenderer
  done: () => void
}

/** The keys OpenTUI's own `KeyCodes` table has no name for, spelled as the bytes a terminal sends.
 *
 *  `pressKey` treats a name it does not recognise as text and types it one character at a time, in
 *  silence. So `pressKey('PAGEDOWN')` typed eight letters, and the `G` among them is `last`: a case
 *  meaning to press Page Down pressed End instead, landed on the last row, and passed. Anything this
 *  host binds and `KeyCodes` does not name belongs here. The shell harness presses through this same
 *  table, so a case cannot press one spelling in one file and another in the other (../harness.tsx). */
export const RAW_KEYS: Record<string, string> = {
  PAGEUP: '\x1b[5~',
  PAGEDOWN: '\x1b[6~',
}

// How long to wait after a keystroke before reading the screen.
//
// A real wait rather than a flush, because a lone Escape is the start of every escape sequence there
// is and the terminal's own parser holds it until it is sure nothing follows. Flushing the render
// loop does not make that timer run.
const KEY_SETTLE_MS = 80

/**
 * The renderer, the frame readers, the key queue and the pointer, from whichever painter this build
 * picked. The same six answers `../harness.tsx § Surface` gives for the whole shell, plus the mouse
 * two, because a kit case clicks and scrolls where a shell case does not.
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

const openSurface = async (size: { width: number; height: number }): Promise<Surface> => {
  if (drawsOwn()) {
    const renderer = openOwnRenderer({ cols: size.width, rows: size.height })
    return {
      renderer: renderer as unknown as CliRenderer,
      // Turn the event loop until the tree stops asking for frames, then draw once, for the reason
      // `../harness.tsx § ownSurface` gives: one frame produces the next, so a fixed number of turns
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
      // listens. Wiring the parser's own paste events into it is the next slice
      // (../keys/install.ts § pasteInto).
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
  const { createTestRenderer } = await import('@opentui/core/testing')
  const setup = await createTestRenderer({
    width: size.width,
    height: size.height,
    kittyKeyboard: true,
    autoFocus: false,
  })
  return {
    renderer: setup.renderer,
    flush: setup.flush,
    captureCharFrame: setup.captureCharFrame,
    runs: () => setup.captureSpans().lines.flatMap((line) => line.spans.map((span) => ({
      text: span.text,
      fg: { r: span.fg.r, g: span.fg.g, b: span.fg.b },
      attributes: span.attributes,
    }))),
    resize: setup.resize,
    pressKey: (key, modifiers) => { setup.mockInput.pressKey(RAW_KEYS[key] ?? key, modifiers) },
    pasteText: (text) => { void setup.mockInput.pasteBracketedText(text) },
    scroll: (x, y, direction) => setup.mockMouse.scroll(x, y, direction),
    click: (x, y) => setup.mockMouse.click(x, y),
    destroy: () => setup.renderer.destroy(),
  }
}

/** Render a fragment at a size, with the keymap installed on it. Small by default, because a node
 *  under test is a node and not a screen, and a wide buffer hides a node that overflows its row. */
export async function renderCells(
  node: () => JSX.Element,
  size: { width?: number; height?: number } = {},
): Promise<Cells> {
  const { render } = await import('@opentui/solid')
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
  // The same keyboard protocol the app asks for (../main.tsx), because without it Ctrl+Return is the
  // same byte as Return and half of what this suite presses would not exist.
  // `autoFocus` off for the reason the app has it off: focus is the region store's and a renderer
  // that focuses on a click by itself is a second owner (../keys/regions.ts § Clicks are hit tests).
  const setup = await openSurface({ width: size.width ?? 40, height: size.height ?? 8 })
  setup.renderer.setMaxListeners(RENDERER_LISTENER_CAP)
  installKeymap(setup.renderer)
  // The root node under our painter and the renderer under OpenTUI's, which is the one line of the
  // mount that differs between them (../harness.tsx § Surface).
  const mounted = await render(node, (drawsOwn() ? (setup.renderer as unknown as { root: unknown }).root : setup.renderer) as never)
  // The Solid root as well as the surface. `@opentui/solid` disposes the root inside
  // `renderer.destroy()`; ours hands the disposer back and leaves the lifetime to the caller, and a
  // tree left mounted re-runs its effects against a torn-down keymap (../harness.tsx § previous).
  const tearDown = (): void => {
    if (drawsOwn()) (mounted as unknown as () => void)()
    setup.destroy()
  }
  // Bounded, and the frame is taken either way: a tree that never settles is itself a finding, and a
  // capture that hangs says nothing about which node did it.
  const settle = (ms: number) => Promise.race([setup.flush(), new Promise((done) => setTimeout(done, ms))])
  await settle(2000)
  // OpenTUI patches `console.*` and pops its own overlay over the frame when anything logs. Whatever
  // logged is worth seeing on stderr; it is not worth drawing over the screen under test.
  setup.renderer.console.deactivate()
  setup.renderer.console.hide()
  await settle(500)

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
  const press = async (
    key: string,
    modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean },
  ): Promise<Cells> => {
    setup.pressKey(key, modifiers)
    await new Promise((done) => setTimeout(done, KEY_SETTLE_MS))
    return frame()
  }
  const scroll = async (x: number, y: number, direction: 'up' | 'down'): Promise<Cells> => {
    await setup.scroll(x, y, direction)
    return frame()
  }
  const paste = async (text: string): Promise<Cells> => {
    setup.pasteText(text)
    await new Promise((done) => setTimeout(done, KEY_SETTLE_MS))
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
