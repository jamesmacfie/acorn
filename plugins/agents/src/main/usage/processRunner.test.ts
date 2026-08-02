import type { IDisposable } from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePty, renderTerminalCapture, type PtyProcess, type PtySpawner } from './processRunner'

class FakePty implements PtyProcess {
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  readonly writes: string[] = []
  killCount = 0

  readonly onData = (listener: (data: string) => void): IDisposable => {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }

  write(data: string | Buffer): void {
    this.writes.push(data.toString())
  }

  kill(): void {
    this.killCount += 1
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(exitCode: number): void {
    for (const listener of this.exitListeners) listener({ exitCode })
  }
}

const setup = () => {
  const pty = new FakePty()
  const spawnPty: PtySpawner = () => pty
  const run = (overrides: Partial<Parameters<typeof capturePty>[0]> = {}) =>
    capturePty({
      command: 'fake',
      args: [],
      cwd: '/tmp',
      idleMs: 10,
      timeoutMs: 100,
      spawnPty,
      resolveCommand: () => '/fake',
      ...overrides,
    })
  return { pty, run }
}

describe('renderTerminalCapture', () => {
  it('applies cursor-addressed redraws instead of exposing raw ANSI history', async () => {
    const output = await renderTerminalCapture('old value\rnew value', { cols: 40, rows: 4 })
    expect(output).toContain('new value')
    expect(output).not.toContain('old value')
  })

  it('reads the active alternate screen', async () => {
    const output = await renderTerminalCapture('\x1b[?1049hCurrent session\r\n82% left', { cols: 40, rows: 4 })
    expect(output).toContain('Current session')
    expect(output).toContain('82% left')
  })
})

describe('capturePty', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers a matching prompt once and finishes after meaningful idle', async () => {
    vi.useFakeTimers()
    const { pty, run } = setup()
    const result = run({ promptResponses: [{ pattern: /trust this folder/i, response: '\r' }] })
    pty.emitData('Trust this folder?')
    pty.emitData('Trust this folder?')
    expect(pty.writes).toEqual(['\r'])
    await vi.advanceTimersByTimeAsync(11)
    await expect(result).resolves.toMatchObject({ output: expect.stringContaining('Trust this folder?') })
    expect(pty.killCount).toBe(1)
  })

  it('times out and kills a silent process', async () => {
    vi.useFakeTimers()
    const { pty, run } = setup()
    const result = run({ timeoutMs: 20 })
    const rejection = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(21)
    await rejection
    expect(pty.killCount).toBe(1)
  })

  it('caps captured output and kills the process', async () => {
    const { pty, run } = setup()
    const result = run({ maxBytes: 3 })
    const rejection = expect(result).rejects.toMatchObject({ code: 'output_limit' })
    pty.emitData('four')
    await rejection
    expect(pty.killCount).toBe(1)
  })

  it('returns on process exit and disposes listeners', async () => {
    const { pty, run } = setup()
    const result = run()
    pty.emitData('complete')
    pty.emitExit(0)
    await expect(result).resolves.toEqual({ output: expect.stringContaining('complete'), exitCode: 0 })
    expect(pty.killCount).toBe(1)
    pty.emitData('ignored')
  })

  it('sends startup input after the configured delay', async () => {
    vi.useFakeTimers()
    const { pty, run } = setup()
    const result = run({ startupInput: '/status\r', startupInputDelayMs: 5 })
    await vi.advanceTimersByTimeAsync(5)
    expect(pty.writes).toEqual(['/status\r'])
    pty.emitData('5h limit 90% left')
    await vi.advanceTimersByTimeAsync(11)
    await result
  })
})
