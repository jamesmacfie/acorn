import { createRequire } from 'node:module'
import type { ServerMsg, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'

// Keep this binding distinct from the `require` shim the bundler (Rolldown) generates when it
// flattens the service graph. A source-level `require` binding makes the production service bundle
// syntactically invalid even though TypeScript and the unbundled unit tests both pass.
const nodeRequire = createRequire(import.meta.url)

type BufferLine = { isWrapped: boolean; translateToString(trimRight?: boolean): string }

type HeadlessTerminal = {
  buffer: { active: { length: number; getLine(index: number): BufferLine | undefined } }
  write(data: string, callback?: () => void): void
  resize(cols: number, rows: number): void
  loadAddon(addon: { activate(terminal: unknown): void; dispose(): void }): void
  dispose(): void
}

type SerializeAddon = {
  activate(terminal: unknown): void
  serialize(options?: { scrollback?: number }): string
  dispose(): void
}

const { Terminal } = nodeRequire('@xterm/headless') as {
  Terminal: new (options: {
    cols: number
    rows: number
    scrollback: number
    allowProposedApi: boolean
  }) => HeadlessTerminal
}
const { SerializeAddon } = nodeRequire('@xterm/addon-serialize') as {
  SerializeAddon: new () => SerializeAddon
}

const DISPLAY_SCROLLBACK_LINES = 1_000
export const DISPLAY_RESET = '\x1bc'

/**
 * The last `lines` lines of a session's output as plain text, the way the screen shows them: cursor
 * movement and colour applied, escape codes gone, and a line the terminal wrapped joined back into one.
 *
 * From a throwaway emulator over the raw ring, not the display's own, because the display only keeps
 * an emulator while an attach is waiting for one. `SerializeAddon` is no help here: it writes escape
 * codes so a client can repaint, and a model reading this wants the text.
 */
export async function outputText(history: string, cols: number, rows: number, lines: number): Promise<string> {
  const terminal = new Terminal({ cols, rows, scrollback: DISPLAY_SCROLLBACK_LINES, allowProposedApi: true })
  try {
    await new Promise<void>((resolve) => terminal.write(history, resolve))
    const buffer = terminal.buffer.active
    const joined: string[] = []
    for (let index = 0; index < buffer.length; index++) {
      const line = buffer.getLine(index)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && joined.length) joined[joined.length - 1] += text
      else joined.push(text)
    }
    // The rows below the cursor are blank screen, not output.
    while (joined.length && !joined.at(-1)!.trim()) joined.pop()
    return joined.slice(-lines).join('\n')
  } finally {
    terminal.dispose()
  }
}

export type TerminalScreen = {
  write(data: string): void
  resize(cols: number, rows: number): void
  snapshot(): Promise<string>
  dispose(): void
}

export type TerminalDisplaySink = (message: ServerMsg) => void

// The PTY stream is a sequence of cursor operations, not a screen that can safely be replayed from
// an arbitrary byte offset. Keep a real terminal framebuffer on the node and serialize that canonical
// state whenever a client attaches. Operations share one promise chain so a snapshot is an exact
// barrier: output received after it is requested cannot leak into the snapshot.
export class HeadlessTerminalScreen implements TerminalScreen {
  private readonly terminal: HeadlessTerminal
  private readonly serializer: SerializeAddon
  private pending: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback: DISPLAY_SCROLLBACK_LINES,
      // addon-serialize reads the headless buffer API, which xterm 5.5 still marks proposed.
      allowProposedApi: true,
    })
    this.serializer = new SerializeAddon()
    this.terminal.loadAddon(this.serializer)
  }

  write(data: string): void {
    if (!data || this.disposed) return
    this.enqueue(() => new Promise<void>((resolve) => this.terminal.write(data, resolve)))
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return
    this.enqueue(() => {
      this.terminal.resize(cols, rows)
    })
  }

  snapshot(): Promise<string> {
    if (this.disposed) return Promise.resolve('')
    let snapshot = ''
    const done = this.enqueue(() => {
      snapshot = this.serializer.serialize({ scrollback: DISPLAY_SCROLLBACK_LINES })
    })
    return done.then(() => snapshot)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // Let an in-flight write callback settle before tearing down xterm's parser.
    void this.pending.then(
      () => this.terminal.dispose(),
      () => this.terminal.dispose(),
    )
  }

  private enqueue(operation: () => void | Promise<void>): Promise<void> {
    const run = async () => {
      if (!this.disposed) await operation()
    }
    // Recover the queue after an individual emulator failure so later PTY output can still render.
    this.pending = this.pending.then(run, run)
    return this.pending
  }
}

type PendingAttachment = { frames: ServerMsg[] }

// Owns client attachment ordering around the framebuffer above. While a snapshot is being
// serialized, live frames are retained per attaching sink. The sink receives:
//   ready → reset + canonical snapshot → every frame published after the snapshot barrier.
//
// **Emulation is a consequence of restoring a screen.** There is an emulator here only while an
// attach is waiting for its snapshot. Its only reader is that snapshot, so an attach builds one from
// the raw ring, serializes it, and the emulator goes as soon as no attach is waiting. A client that is
// already attached does not need one: it has every byte, in its own xterm. The desktop client keeps a
// tab attached from its first open until it is closed, so an emulator kept "while attached" would parse
// every build in every tab anybody had opened, for a screen no attach would read.
//
// The price is scrollback: every attach rebuilds from what the ring still holds, so history older
// than the ring is gone and an alternate-screen program whose state depends on older bytes redraws
// from its next output. Copying output into the ring costs far less than parsing it, and an attach pays
// one rebuild, once per tab and again after a reconnect (docs/terminal/sessions.md § The screen, and who
// pays for it).
export class TerminalDisplay {
  private readonly live = new Set<TerminalDisplaySink>()
  private readonly attaching = new Map<TerminalDisplaySink, PendingAttachment>()
  private hasOutput = false
  private screen: TerminalScreen | null = null

  constructor(
    private cols: number,
    private rows: number,
    // Injected so a test can drive the ordering without a real emulator, and called per emulator
    // rather than once per session, since there is one per watched period rather than one for life.
    private readonly makeScreen: (cols: number, rows: number) => TerminalScreen = (cols, rows) =>
      new HeadlessTerminalScreen(cols, rows),
  ) {}

  write(data: string): void {
    if (!data) return
    // Remembered even with no emulator, because it is what tells a later attach whether there is a
    // screen worth rebuilding at all.
    this.hasOutput = true
    this.screen?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.screen?.resize(cols, rows)
  }

  /** Whether an emulator is running. The property the tests assert on. */
  get emulating(): boolean {
    return this.screen !== null
  }

  publish(message: ServerMsg): void {
    for (const sink of this.live) sink(message)
    for (const pending of this.attaching.values()) pending.frames.push(message)
  }

  /**
   * Subscribe a client and restore its screen. `replay` hands over the session's raw ring, read only
   * when an emulator has to be built, so an attach that lands while another is still restoring shares
   * its emulator.
   */
  attach(sink: TerminalDisplaySink, session: TerminalSession, replay: () => string): void {
    const replayed = this.hasOutput
    sink({ type: 'ready', session, replayed })
    // Nothing to restore, so nothing to emulate: the client sees every byte from here on live.
    if (!replayed) {
      this.live.add(sink)
      return
    }
    // Before the snapshot below and before any further live write, so the replay and the live bytes
    // meet exactly once.
    const screen = this.ensure(replay)

    // snapshot() installs its barrier synchronously. Any later publish belongs after the snapshot
    // and is captured in this attachment's frame queue until activate() transfers it to live.
    const snapshot = screen.snapshot()
    const pending: PendingAttachment = { frames: [] }
    this.attaching.set(sink, pending)
    void snapshot
      .then((data) => {
        if (this.attaching.get(sink) !== pending) return
        if (data) sink({ type: 'output', data: `${DISPLAY_RESET}${data}` })
        this.activate(sink, pending)
      })
      .catch(() => {
        if (this.attaching.get(sink) !== pending) return
        sink({ type: 'error', code: 'screen_snapshot_failed', message: 'Could not restore the terminal display.' })
        this.activate(sink, pending)
      })
  }

  detach(sink: TerminalDisplaySink): void {
    this.attaching.delete(sink)
    this.live.delete(sink)
    this.release()
  }

  dispose(): void {
    this.attaching.clear()
    this.live.clear()
    this.release()
  }

  private ensure(replay: () => string): TerminalScreen {
    if (this.screen) return this.screen
    const screen = this.makeScreen(this.cols, this.rows)
    this.screen = screen
    // One string rather than chunk by chunk: the ring is bytes, and a character split across two of
    // its chunks has to be decoded whole before the parser sees it (./terminalUtils.ts, OutputRing).
    const history = replay()
    if (history) screen.write(history)
    return screen
  }

  // The last attach waiting on a snapshot is what stops the parser, whoever is still attached. A
  // session with no emulator still fills its ring, which is what the next attach rebuilds from.
  private release(): void {
    if (this.attaching.size > 0) return
    this.screen?.dispose()
    this.screen = null
  }

  private activate(sink: TerminalDisplaySink, pending: PendingAttachment): void {
    this.attaching.delete(sink)
    this.live.add(sink)
    for (const frame of pending.frames) sink(frame)
    this.release()
  }
}
