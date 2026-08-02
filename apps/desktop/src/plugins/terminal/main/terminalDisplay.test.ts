import { describe, expect, it } from 'vitest'
import type { ServerMsg, TerminalSession } from '@acorn/protocol/terminal.ts'
import {
  DISPLAY_RESET,
  HeadlessTerminalScreen,
  TerminalDisplay,
  type TerminalScreen,
} from './terminalDisplay'

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

  it('resets a stale renderer before restoring the serialized snapshot', async () => {
    const source = new HeadlessTerminalScreen(20, 5)
    const renderer = new HeadlessTerminalScreen(20, 5)
    source.write('canonical')
    renderer.write('stale-client-history')

    renderer.write(`${DISPLAY_RESET}${await source.snapshot()}`)
    const restored = await renderer.snapshot()

    expect(restored).toContain('canonical')
    expect(restored).not.toContain('stale-client-history')
    source.dispose()
    renderer.dispose()
  })
})

describe('TerminalDisplay', () => {
  it('buffers live frames behind the canonical snapshot during attach', async () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, screen)
    const frames: ServerMsg[] = []
    display.write('raw cursor history')
    display.attach((message) => frames.push(message), session)
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

  it('cancels a pending snapshot when the renderer detaches', async () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, screen)
    const frames: ServerMsg[] = []
    const sink = (message: ServerMsg) => frames.push(message)
    display.write('history')
    display.attach(sink, session)
    display.detach(sink)

    screen.resolve('canonical')
    await nextTurn()
    display.publish({ type: 'output', data: 'live' })

    expect(frames).toEqual([{ type: 'ready', session, replayed: true }])
  })

  it('attaches immediately when no display state needs restoring', () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, screen)
    const frames: ServerMsg[] = []
    display.attach((message) => frames.push(message), session)
    display.publish({ type: 'output', data: 'first' })

    expect(frames).toEqual([
      { type: 'ready', session, replayed: false },
      { type: 'output', data: 'first' },
    ])
  })

  it('keeps resize and disposal ownership with the display model', () => {
    const screen = new DeferredScreen()
    const display = new TerminalDisplay(20, 5, screen)

    display.resize(40, 10)
    display.dispose()

    expect(screen.resizes).toEqual([[40, 10]])
    expect(screen.disposed).toBe(true)
  })
})
