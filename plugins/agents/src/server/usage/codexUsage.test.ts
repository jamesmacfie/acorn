import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectCodexUsage,
  parseCodexRpcResponse,
  parseCodexTtyOutput,
  readCodexRateLimitsViaRpc,
  type CodexRpcProcess,
} from './codexUsage'
import { UsageProcessError } from './processRunner'

class FakeRpcProcess implements CodexRpcProcess {
  private dataListeners = new Set<(chunk: string) => void>()
  private exitListeners = new Set<(code: number | null) => void>()
  private errorListeners = new Set<(error: Error) => void>()
  readonly writes: string[] = []
  ended = 0
  killed = 0
  onWrite?: (message: Record<string, unknown>) => void

  write(line: string): void {
    this.writes.push(line)
    this.onWrite?.(JSON.parse(line) as Record<string, unknown>)
  }

  end(): void {
    this.ended += 1
  }

  kill(): void {
    this.killed += 1
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  emit(message: unknown): void {
    for (const listener of this.dataListeners) listener(`${JSON.stringify(message)}\n`)
  }

  emitRaw(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk)
  }
}

afterEach(() => vi.useRealTimers())

describe('Codex app-server JSON-RPC', () => {
  it('performs the handshake, ignores notifications, reads limits, and cleans up', async () => {
    const process = new FakeRpcProcess()
    process.onWrite = (message) => {
      if (message.method === 'initialize') {
        process.emit({ method: 'account/updated', params: {} })
        process.emit({ id: message.id, result: {} })
      }
      if (message.method === 'account/rateLimits/read') {
        process.emit({
          id: message.id,
          result: {
            rateLimits: {
              planType: 'plus',
              primary: { usedPercent: 12, resetsAt: 1_800_000_000 },
              secondary: { usedPercent: 65, resetsAt: 1_800_500_000 },
            },
          },
        })
      }
    }

    const response = await readCodexRateLimitsViaRpc(() => process)
    const provider = parseCodexRpcResponse(response, 10)
    expect(process.writes.map((line) => (JSON.parse(line) as { method: string }).method)).toEqual([
      'initialize',
      'initialized',
      'account/rateLimits/read',
    ])
    expect(provider.plan).toBe('plus')
    expect(provider.quotas).toEqual([
      expect.objectContaining({ id: 'session', percentRemaining: 88, resetsAt: 1_800_000_000_000 }),
      expect.objectContaining({ id: 'weekly', percentRemaining: 35, resetsAt: 1_800_500_000_000 }),
    ])
    expect(process.ended).toBe(1)
    expect(process.killed).toBe(1)
  })

  it('times out a silent process and still cleans it up', async () => {
    vi.useFakeTimers()
    const process = new FakeRpcProcess()
    const result = readCodexRateLimitsViaRpc(() => process, { timeoutMs: 20 })
    const rejection = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(21)
    await rejection
    expect(process.ended).toBe(1)
    expect(process.killed).toBe(1)
  })

  it('caps untrusted app-server output', async () => {
    const process = new FakeRpcProcess()
    process.onWrite = () => {
      process.emitRaw('too much output')
    }
    const result = readCodexRateLimitsViaRpc(() => process, { maxBytes: 3 })
    await expect(result).rejects.toMatchObject({ code: 'output_limit' })
  })
})

describe('Codex response and TTY parsing', () => {
  it('represents a free plan without inventing weekly data', () => {
    const provider = parseCodexRpcResponse({ result: { rateLimits: { planType: 'free' } } }, 10)
    expect(provider.quotas).toEqual([
      expect.objectContaining({ id: 'session', label: 'Free plan', percentRemaining: 100 }),
    ])
  })

  it('rejects malformed and empty paid responses', () => {
    expect(() => parseCodexRpcResponse({ nope: true })).toThrowError(expect.objectContaining({ code: 'parse_failure' }))
    expect(() => parseCodexRpcResponse({ result: { rateLimits: { planType: 'plus' } } })).toThrowError(
      expect.objectContaining({ code: 'parse_failure' }),
    )
  })

  it('parses 5h and weekly left percentages from the TTY fallback', () => {
    const provider = parseCodexTtyOutput('5h limit\n91% left\nWeekly limit\n42% left', 10)
    expect(provider.quotas).toEqual([
      expect.objectContaining({ id: 'session', percentRemaining: 91 }),
      expect.objectContaining({ id: 'weekly', percentRemaining: 42 }),
    ])
  })

  it('classifies TTY authentication and update errors', () => {
    expect(() => parseCodexTtyOutput('Please log in')).toThrowError(expect.objectContaining({ code: 'authentication_required' }))
    expect(() => parseCodexTtyOutput('Codex update available')).toThrowError(expect.objectContaining({ code: 'update_required' }))
  })
})

describe('collectCodexUsage', () => {
  it('falls back to a read-only TTY status command when RPC fails', async () => {
    const seen: Array<{ args: string[]; input: string | undefined }> = []
    const provider = await collectCodexUsage({
      cwd: '/tmp',
      now: () => 10,
      startRpc: () => {
        throw new UsageProcessError('execution_failure', 'rpc unavailable')
      },
      runPty: async (options) => {
        seen.push({ args: options.args, input: options.startupInput })
        return { output: '5h limit 80% left\nWeekly limit 20% left', exitCode: null }
      },
    })
    expect(seen).toEqual([{ args: ['-s', 'read-only', '-a', 'untrusted'], input: '/status\r' }])
    expect(provider.quotas.map((quota) => quota.percentRemaining)).toEqual([80, 20])
  })

  it('reports the fallback failure when both paths fail', async () => {
    const result = collectCodexUsage({
      cwd: '/tmp',
      startRpc: () => {
        throw new UsageProcessError('execution_failure', 'rpc unavailable')
      },
      runPty: async () => {
        throw new UsageProcessError('authentication_required', 'sign in')
      },
    })
    await expect(result).rejects.toMatchObject({ code: 'authentication_required' })
  })
})
