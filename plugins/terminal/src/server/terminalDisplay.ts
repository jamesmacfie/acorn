import { createRequire } from 'node:module'
import type { ServerMsg, TerminalSession } from '@acorn/protocol/terminal.ts'

// Keep this binding distinct from the `require` shim the bundler (Rolldown) generates when it
// flattens the service graph. A source-level `require` binding makes the production service bundle
// syntactically invalid even though TypeScript and the unbundled unit tests both pass.
const nodeRequire = createRequire(import.meta.url)

type HeadlessTerminal = {
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
  Terminal: new (options: { cols: number; rows: number; scrollback: number; allowProposedApi: boolean }) => HeadlessTerminal
}
const { SerializeAddon } = nodeRequire('@xterm/addon-serialize') as {
  SerializeAddon: new () => SerializeAddon
}

export const DISPLAY_SCROLLBACK_LINES = 1_000
export const DISPLAY_RESET = '\x1bc'

export type TerminalScreen = {
  write(data: string): void
  resize(cols: number, rows: number): void
  snapshot(): Promise<string>
  dispose(): void
}

export type TerminalDisplaySink = (message: ServerMsg) => void

// The PTY stream is a sequence of cursor operations, not a screen that can safely be replayed from
// an arbitrary byte offset. Keep a real terminal framebuffer in main and serialize that canonical
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
// **Emulation is a consequence of attachment.** There is an emulator here only while somebody is
// watching. It used to run at full rate for every session from the moment it was spawned, and its
// only reader is the snapshot `attach` takes — so a background build paid continuous ANSI parsing to
// produce a screen nobody would ever ask for (docs/future/performance/architecture.md § 3). The first
// attach builds one and replays the raw ring into it; the last detach disposes it. Nothing else about
// the ordering below changed.
//
// The price is scrollback: a cold attach can only rebuild from what the ring still holds, so history
// older than the ring is gone and an alternate-screen program whose state depends on older bytes
// redraws from its next output. That is recorded, with the reason it is the right trade, in
// docs/future/performance/refused.md § Scrollback beyond the ring.
export class TerminalDisplay {
  private readonly live = new Set<TerminalDisplaySink>()
  private readonly attaching = new Map<TerminalDisplaySink, PendingAttachment>()
  private hasOutput = false
  private screen: TerminalScreen | null = null

  constructor(
    private cols: number,
    private rows: number,
    // Injected so a test can drive the ordering without a real emulator, and called per emulator
    // rather than once per session, since there is now one per watched period rather than one for
    // life.
    private readonly makeScreen: (cols: number, rows: number) => TerminalScreen = (cols, rows) => new HeadlessTerminalScreen(cols, rows),
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

  /** Whether an emulator is running. The property the phase 6 tests assert on. */
  get emulating(): boolean {
    return this.screen !== null
  }

  publish(message: ServerMsg): void {
    for (const sink of this.live) sink(message)
    for (const pending of this.attaching.values()) pending.frames.push(message)
  }

  /**
   * Subscribe a client and restore its screen. `replay` hands over the session's raw ring, read only
   * when an emulator has to be built, so an attach onto a session that already has one costs nothing
   * extra.
   */
  attach(sink: TerminalDisplaySink, session: TerminalSession, replay: () => string): void {
    const replayed = this.hasOutput
    sink({ type: 'ready', session, replayed })
    // Before the snapshot below and before any further live write, so the replay and the live bytes
    // meet exactly once.
    const screen = this.ensure(replay)
    if (!replayed) {
      this.live.add(sink)
      return
    }

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

  // The last watcher leaving is what stops the parser. A session with no emulator still fills its
  // ring, which is what the next attach rebuilds from.
  private release(): void {
    if (this.live.size > 0 || this.attaching.size > 0) return
    this.screen?.dispose()
    this.screen = null
  }

  private activate(sink: TerminalDisplaySink, pending: PendingAttachment): void {
    this.attaching.delete(sink)
    this.live.add(sink)
    for (const frame of pending.frames) sink(frame)
  }
}
