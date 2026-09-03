import { describe, expect, it } from 'vitest'
import type { ServerMsg, TerminalSession } from '@acorn/protocol/terminal.ts'
import {
  DISPLAY_RESET,
  HeadlessTerminalScreen,
  TerminalDisplay,
  type TerminalScreen,
} from './terminalDisplay'
import { OutputRing } from './terminalUtils'

const session: TerminalSession = {
  id: 'session-1',
  title: 'Codex',
  kind: 'agent',
  profileId: 'codex',
  backend: 'tmux',
  status: 'running',
  idle: false,
  agentState: 'working',
  isWorktree: true,
  taskId: 'task-1',
  cwd: '/worktree',
  command: 'codex',
  cols: 20,
  rows: 5,
  createdAt: 1,
  exitCode: null,
}

class DeferredScreen implements TerminalScreen {
  writes: string[] = []
  resizes: Array<[number, number]> = []
  disposed = false
  private resolveSnapshot: ((value: string) => void) | null = null

  write(data: string): void {
    this.writes.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows])
  }

  snapshot(): Promise<string> {
    return new Promise((resolve) => {
      this.resolveSnapshot = resolve
    })
  }

  resolve(value: string): void {
    this.resolveSnapshot?.(value)
  }

  dispose(): void {
    this.disposed = true
  }
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

// The engine's own arrangement: every chunk goes to the ring and to the display, and the ring is what
// a cold attach replays (./terminal.ts § queueOutput).
const feed = (display: TerminalDisplay, ring: OutputRing, data: string): void => {
  ring.push(data)
  display.write(data)
}

describe('HeadlessTerminalScreen', () => {
  it('serializes the canonical framebuffer instead of obsolete cursor-redraw history', async () => {
    const screen = new HeadlessTerminalScreen(20, 5)
    screen.write('obsolete\r\nkeep')
    screen.write('\x1b[1A\r\x1b[2Kfinal')

    const snapshot = await screen.snapshot()

    expect(snapshot).toContain('final')
    expect(snapshot).toContain('keep')
    expect(snapshot).not.toContain('obsolete')
    screen.dispose()
  })

  it('makes snapshot an ordering barrier for later output', async () => {
    const screen = new HeadlessTerminalScreen(20, 5)
    screen.write('before')
    const before = screen.snapshot()
    screen.write('-after')

    expect(await before).toContain('before')
    expect(await before).not.toContain('after')
    expect(await screen.snapshot()).toContain('before-after')
    screen.dispose()
  })

  it('preserves alternate-screen state used by full-screen TUIs', async () => {
    const screen = new HeadlessTerminalScreen(20, 5)
    screen.write('normal\x1b[?1049h\x1b[Hcodex-screen')

    const snapshot = await screen.snapshot()

    expect(snapshot).toContain('normal')
    expect(snapshot).toContain('\x1b[?1049h')
    expect(snapshot).toContain('codex-screen')
    screen.dispose()
  })

  it('resets a stale client before restoring the serialized snapshot', async () => {
    const source = new HeadlessTerminalScreen(20, 5)
    const client = new HeadlessTerminalScreen(20, 5)
    source.write('canonical')
    client.write('stale-client-history')

    client.write(`${DISPLAY_RESET}${await source.snapshot()}`)
    const restored = await client.snapshot()

    expect(restored).toContain('canonical')
    expect(restored).not.toContain('stale-client-history')
    source.dispose()
    client.dispose()
  })
})

describe('TerminalDisplay', () => {
  it('buffers live frames behind the canonical snapshot during attach', async () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, () => screen)
    const frames: ServerMsg[] = []
    display.write('raw cursor history')
    display.attach((message) => frames.push(message), session, () => '')
    display.publish({ type: 'output', data: 'live' })

    expect(frames).toEqual([{ type: 'ready', session, replayed: true }])

    screen.resolve('canonical')
    await nextTurn()

    expect(frames).toEqual([
      { type: 'ready', session, replayed: true },
      { type: 'output', data: `${DISPLAY_RESET}canonical` },
      { type: 'output', data: 'live' },
    ])
  })

  it('cancels a pending snapshot when the client detaches', async () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, () => screen)
    const frames: ServerMsg[] = []
    const sink = (message: ServerMsg) => frames.push(message)
    display.write('history')
    display.attach(sink, session, () => '')
    display.detach(sink)

    screen.resolve('canonical')
    await nextTurn()
    display.publish({ type: 'output', data: 'live' })

    expect(frames).toEqual([{ type: 'ready', session, replayed: true }])
  })

  it('attaches immediately when no display state needs restoring', () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, () => screen)
    const frames: ServerMsg[] = []
    display.attach((message) => frames.push(message), session, () => '')
    display.publish({ type: 'output', data: 'first' })

    expect(frames).toEqual([
      { type: 'ready', session, replayed: false },
      { type: 'output', data: 'first' },
    ])
  })

  it('keeps resize and disposal ownership with the display model', () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, () => screen)
    // Resizing reaches the emulator only while there is one, so this attaches first. A resize with
    // nobody watching is remembered and applied to whatever the next attach builds — the case below.
    display.attach(() => {}, session, () => '')

    display.resize(40, 10)
    display.dispose()

    expect(screen.resizes).toEqual([[40, 10]])
    expect(screen.disposed).toBe(true)
  })
})

// Phase 6 of the performance programme: the emulator is a consequence of attachment
// (docs/performance.md § 2026-09-03 — phase 6).
describe('TerminalDisplay emulates only while somebody is watching', () => {
  it('builds no emulator for a session nobody has attached to', () => {
    let built = 0
    const display = new TerminalDisplay(20, 5, () => {
      built += 1
      return new DeferredScreen()
    })

    for (let i = 0; i < 100; i += 1) display.write(`line ${i}\r\n`)

    expect(built).toBe(0)
    expect(display.emulating).toBe(false)
  })

  it('disposes the emulator when the last watcher leaves, and builds a new one for the next', () => {
    const screens: DeferredScreen[] = []
    const display = new TerminalDisplay(20, 5, () => {
      const screen = new DeferredScreen()
      screens.push(screen)
      return screen
    })
    const first = () => {}
    const second = () => {}

    display.attach(first, session, () => '')
    display.attach(second, session, () => '')
    expect(screens).toHaveLength(1)

    display.detach(first)
    expect(display.emulating).toBe(true) // one client left, so the parser is still earning its keep
    expect(screens[0].disposed).toBe(false)

    display.detach(second)
    expect(display.emulating).toBe(false)
    expect(screens[0].disposed).toBe(true)

    display.attach(first, session, () => '')
    expect(screens).toHaveLength(2)
  })

  it('replays the ring at the size the session has now, not the size it was created at', () => {
    const screens: DeferredScreen[] = []
    const display = new TerminalDisplay(20, 5, (cols, rows) => {
      const screen = new DeferredScreen()
      screen.resizes.push([cols, rows])
      screens.push(screen)
      return screen
    })

    display.resize(120, 40)
    display.attach(() => {}, session, () => 'history')

    expect(screens[0].resizes).toEqual([[120, 40]])
    expect(screens[0].writes).toEqual(['history'])
  })

  it('rebuilds the same visible screen a session that emulated throughout would have shown', async () => {
    // A full-screen program's output: cursor moves, a line erased and rewritten, and an alternate
    // screen. Replaying raw bytes would show the erased line; the emulator must not.
    const chunks = [
      'first line\r\nsecond line\r\n',
      '\x1b[1A\r\x1b[2Krewritten\r\n',
      '\x1b[?1049h\x1b[Hfull screen\r\n',
      'ünïcøde 🌰 and a tail\r\n',
    ]

    // Watched from the first byte: one emulator, fed live, read by a second attach.
    const watchedRing = new OutputRing()
    const watched = new TerminalDisplay(20, 5)
    watched.attach(() => {}, session, () => '')
    for (const chunk of chunks) feed(watched, watchedRing, chunk)

    // Never watched: no emulator at all until this attach builds one from the ring.
    const coldRing = new OutputRing()
    const cold = new TerminalDisplay(20, 5)
    for (const chunk of chunks) feed(cold, coldRing, chunk)
    expect(cold.emulating).toBe(false)

    const screenOf = async (display: TerminalDisplay, ring: OutputRing): Promise<string> => {
      const frames: ServerMsg[] = []
      display.attach((message) => frames.push(message), session, () => ring.tail())
      for (let turn = 0; turn < 5; turn += 1) await nextTurn()
      const output = frames.find((frame) => frame.type === 'output')
      return output?.type === 'output' ? output.data : ''
    }

    const restored = await screenOf(cold, coldRing)
    const live = await screenOf(watched, watchedRing)

    expect(restored).toContain('full screen')
    expect(restored).toContain('🌰')
    expect(restored).not.toContain('second line')
    expect(restored).toBe(live)
    cold.dispose()
    watched.dispose()
  })
})
