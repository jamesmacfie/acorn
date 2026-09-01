/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js'

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
  resize: (width: number, height: number) => Promise<Cells>
  done: () => void
}

// How long to wait after a keystroke before reading the screen.
//
// A real wait rather than a flush, because a lone Escape is the start of every escape sequence there
// is and the terminal's own parser holds it until it is sure nothing follows. Flushing the render
// loop does not make that timer run.
const KEY_SETTLE_MS = 80

/** Render a fragment at a size, with the keymap installed on it. Small by default, because a node
 *  under test is a node and not a screen, and a wide buffer hides a node that overflows its row. */
export async function renderCells(
  node: () => JSX.Element,
  size: { width?: number; height?: number } = {},
): Promise<Cells> {
  const { createTestRenderer } = await import('@opentui/core/testing')
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
  const setup = await createTestRenderer({ width: size.width ?? 40, height: size.height ?? 8, kittyKeyboard: true })
  setup.renderer.setMaxListeners(RENDERER_LISTENER_CAP)
  installKeymap(setup.renderer)
  await render(node, setup.renderer)
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
      runs: () => setup.captureSpans().lines.flatMap((line) => line.spans.map((span) => ({
        text: span.text,
        fg: { r: span.fg.r, g: span.fg.g, b: span.fg.b },
        attributes: span.attributes,
      }))),
      frame,
      press,
      scroll,
      resize,
      done: () => setup.renderer.destroy(),
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
    setup.mockInput.pressKey(key, modifiers)
    await new Promise((done) => setTimeout(done, KEY_SETTLE_MS))
    return frame()
  }
  const scroll = async (x: number, y: number, direction: 'up' | 'down'): Promise<Cells> => {
    await setup.mockMouse.scroll(x, y, direction)
    return frame()
  }
  const resize = async (width: number, height: number): Promise<Cells> => {
    setup.resize(width, height)
    return frame()
  }
  return read()
}
