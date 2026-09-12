import { layoutTree } from '../layout/pass'
import { onFrame } from '../tree/frames'
import { createElement, setProperty } from '../tree/renderer'
import type { Renderable } from '../tree/compat'
import { bufferLines, bufferRuns, clearBuffer, createBuffer, resizeBuffer, type Buffer, type Run } from './buffer'
import { flush, type Flush } from './flush'
import { paint } from './paint'

// The two buffers, the size, and the frame.
//
// A frame is: lay the tree out, paint it into the back buffer, write the difference from the front
// buffer, swap. There is no timer and no frame rate — `../tree/frames.ts` asks for a frame when the
// tree changes and coalesces a burst of signal writes into one, so a screen nobody is touching costs
// nothing at all.
//
// **Layout runs on every frame rather than when something is dirty**, and those are the same set: a
// frame only happens because an operation on the tree asked for one, and every one of those
// operations is a change Yoga has to be asked about. Yoga is asked in turn — it only re-measures the
// nodes it marked dirty — so the check would be ours to keep and Yoga's to make anyway. A 1,708-node
// pane lays out in 0.19 ms warm, against a 5 ms budget.
//
// **The sink is injectable and that is not only for tests.** Paint writes to one function that takes
// a string, so the test harness reads frames without a terminal and the real boot hands it
// `process.stdout.write`. Which is also the promise `../kit/render.tsx` already makes to every kit
// test (docs/tui.md § Tests).
//
// The terminal's own setup — the alternate screen, raw mode, the protocol requests — is not here. It
// belongs with the parser that reads their replies, and this module writes nothing but cells.

/** Where the frame goes. */
export type Sink = (text: string) => void

/** How long the three halves of one frame took, in milliseconds. Reported rather than recorded here,
 *  because this module writes cells and knows nothing about telemetry: the renderer turns these into
 *  the `tui.frame` histogram (../renderer.ts, docs/tui.md § What the terminal client reports). */
export type FramePhases = { layoutMs: number; paintMs: number; flushMs: number }

export type Screen = {
  /** The node to mount the app under. Sized to the terminal, so the tree has something to be 100% of. */
  root: Renderable
  size: () => { cols: number; rows: number }
  /** A new terminal size. Clears both buffers and forces a full frame, because every index in them
   *  meant something else a moment ago. */
  resize: (cols: number, rows: number) => void
  /** Lay out, paint, diff, write. Called by the scheduler; called directly by a test that wants a
   *  frame now rather than after the next turn of the event loop. */
  frame: () => Flush
  /** What is on screen, as cells. The front buffer, so it is the frame that was written rather than
   *  the one being built. */
  screen: () => Buffer
  /** What is on screen, as one string per row. */
  lines: () => string[]
  /** …and as coloured runs, which is the half of a frame that says how it was drawn rather than what
   *  it says (./buffer.ts § bufferRuns). */
  runs: () => Run[][]
  /** Stop answering frame requests. The tree survives; nothing draws it. */
  close: () => void
}

const NO_SINK: Sink = () => {}

export function openScreen(options: {
  cols: number
  rows: number
  write?: Sink
  /** A root of the caller's own, for a test that built one by hand. */
  root?: Renderable
  /** Told how long each half of every frame took. Four `performance.now()` reads on the paint path,
   *  about 160 ns against a 5 ms frame budget, which is why it is unconditional rather than gated:
   *  a gate here would be a branch of its own and a second code path to keep right. */
  onPhases?: (phases: FramePhases) => void
}): Screen {
  let cols = Math.max(0, Math.trunc(options.cols))
  let rows = Math.max(0, Math.trunc(options.rows))
  const write = options.write ?? NO_SINK

  const root = options.root ?? createElement('box')
  let front = createBuffer(cols, rows)
  let back = createBuffer(cols, rows)
  // The first frame has nothing on screen to compare against, so it is a full one — and it erases,
  // because whatever the shell left on the alternate screen is not ours.
  let erase = true

  const sizeRoot = (): void => {
    setProperty(root, 'width', cols)
    setProperty(root, 'height', rows)
  }
  sizeRoot()

  const frame = (): Flush => {
    const t0 = performance.now()
    clearBuffer(back)
    layoutTree(root, cols, rows)
    const t1 = performance.now()
    paint(root, back)
    const t2 = performance.now()
    const written = flush(front, back, erase)
    erase = false
    if (written.text !== '') write(written.text)
    // After the write, because the bytes reaching the terminal are the flush as a person means it.
    const t3 = performance.now()
    options.onPhases?.({ layoutMs: t1 - t0, paintMs: t2 - t1, flushMs: t3 - t2 })
    // Swap rather than copy: the frame just written becomes what is on screen, and the buffer it
    // replaces is the one the next frame paints into after it is cleared.
    const drawn = back
    back = front
    front = drawn
    return written
  }

  onFrame(frame)

  return {
    root,
    size: () => ({ cols, rows }),
    resize: (nextCols, nextRows) => {
      const wide = Math.max(0, Math.trunc(nextCols))
      const tall = Math.max(0, Math.trunc(nextRows))
      if (wide === cols && tall === rows) return
      cols = wide
      rows = tall
      resizeBuffer(front, cols, rows)
      resizeBuffer(back, cols, rows)
      erase = true
      sizeRoot()
    },
    frame,
    screen: () => front,
    lines: () => bufferLines(front),
    runs: () => bufferRuns(front),
    close: () => onFrame(null),
  }
}
