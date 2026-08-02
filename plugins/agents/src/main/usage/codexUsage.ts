import { spawn } from 'node:child_process'
import type { AgentProviderUsage, AgentUsageQuota } from '../../shared/usage'
import { clampRemaining, usageHealth, worstUsageHealth } from '../../shared/usage'
import {
  capturePty,
  resolveUsageCommand,
  UsageProcessError,
  usageProcessEnv,
  type PtyCaptureOptions,
  type PtyCaptureResult,
} from './processRunner'

export type CodexRpcProcess = {
  write(line: string): void
  end(): void
  kill(): void
  onData(listener: (chunk: string) => void): () => void
  onExit(listener: (code: number | null) => void): () => void
  onError(listener: (error: Error) => void): () => void
}

export type StartCodexRpcProcess = () => CodexRpcProcess

export type CodexUsageOptions = {
  cwd: string
  now?: () => number
  startRpc?: StartCodexRpcProcess
  runPty?: (options: PtyCaptureOptions) => Promise<PtyCaptureResult>
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function startCodexAppServer(): CodexRpcProcess {
  const env = usageProcessEnv()
  const executable = resolveUsageCommand('codex', env)
  if (!executable) throw new UsageProcessError('cli_missing', 'codex is not available on PATH.')
  const child = spawn(executable, ['-s', 'read-only', '-a', 'untrusted', 'app-server'], {
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    shell: false,
  })
  return {
    write: (line) => child.stdin.write(line),
    end: () => child.stdin.end(),
    kill: () => {
      if (!child.killed) child.kill()
    },
    onData: (listener) => {
      const handler = (chunk: Buffer) => listener(chunk.toString('utf8'))
      child.stdout.on('data', handler)
      return () => child.stdout.off('data', handler)
    },
    onExit: (listener) => {
      child.on('exit', listener)
      return () => child.off('exit', listener)
    },
    onError: (listener) => {
      child.on('error', listener)
      return () => child.off('error', listener)
    },
  }
}

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }

export async function readCodexRateLimitsViaRpc(
  startRpc: StartCodexRpcProcess = startCodexAppServer,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  const process = startRpc()
  const pending = new Map<number, Pending>()
  let nextId = 1
  let buffered = ''
  let byteCount = 0
  let finished = false
  let failure: Error | null = null

  const failAll = (error: Error) => {
    if (finished) return
    failure ??= error
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }

  const offData = process.onData((chunk) => {
    byteCount += Buffer.byteLength(chunk)
    if (byteCount > maxBytes) {
      failAll(new UsageProcessError('output_limit', `Codex app-server produced more than ${maxBytes} bytes.`))
      return
    }
    buffered += chunk
    while (true) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      if (!line) continue
      let message: Record<string, unknown> | null = null
      try {
        message = asObject(JSON.parse(line))
      } catch {
        // Ignore non-JSON diagnostics and continue to the correlated response.
      }
      if (!message || typeof message.id !== 'number') continue
      const waiter = pending.get(message.id)
      if (!waiter) continue
      pending.delete(message.id)
      const rpcError = asObject(message.error)
      if (rpcError) {
        waiter.reject(
          new UsageProcessError(
            'execution_failure',
            typeof rpcError.message === 'string' ? `Codex RPC: ${rpcError.message}` : 'Codex RPC request failed.',
          ),
        )
      } else {
        waiter.resolve(message)
      }
    }
  })
  const offExit = process.onExit(() => failAll(new UsageProcessError('execution_failure', 'Codex app-server closed unexpectedly.')))
  const offError = process.onError((error) => failAll(new UsageProcessError('execution_failure', error.message)))
  const timeout = setTimeout(
    () => failAll(new UsageProcessError('timeout', `Codex app-server did not respond within ${timeoutMs}ms.`)),
    timeoutMs,
  )

  const request = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      if (failure) {
        reject(failure)
        return
      }
      pending.set(id, { resolve, reject })
      process.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  try {
    await request('initialize', { clientInfo: { name: 'acorn', version: '0.1.0' } })
    process.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
    return await request('account/rateLimits/read')
  } finally {
    finished = true
    clearTimeout(timeout)
    offData()
    offExit()
    offError()
    process.end()
    process.kill()
  }
}

function quota(
  id: string,
  label: string,
  window: Record<string, unknown>,
): AgentUsageQuota | null {
  if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return null
  const percentRemaining = clampRemaining(100 - window.usedPercent)
  const resetSeconds =
    typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? window.resetsAt : null
  return {
    id,
    label,
    percentRemaining,
    resetsAt: resetSeconds == null ? null : resetSeconds * 1_000,
    resetText: null,
    health: usageHealth(percentRemaining),
  }
}

export function parseCodexRpcResponse(message: unknown, capturedAt = Date.now()): AgentProviderUsage {
  const root = asObject(message)
  const result = asObject(root?.result)
  const rateLimits = asObject(result?.rateLimits)
  if (!rateLimits) throw new UsageProcessError('parse_failure', 'Codex RPC response did not contain rate limits.')
  const plan = typeof rateLimits.planType === 'string' ? rateLimits.planType : null
  const primary = asObject(rateLimits.primary)
  const secondary = asObject(rateLimits.secondary)
  const quotas = [
    ...(primary ? [quota('session', 'Session (5h)', primary)] : []),
    ...(secondary ? [quota('weekly', 'Weekly', secondary)] : []),
  ].filter((value): value is AgentUsageQuota => value !== null)
  if (quotas.length === 0 && plan?.toLowerCase() === 'free') {
    quotas.push({
      id: 'session',
      label: 'Free plan',
      percentRemaining: 100,
      resetsAt: null,
      resetText: 'Free plan',
      health: 'healthy',
    })
  }
  if (quotas.length === 0) {
    throw new UsageProcessError('parse_failure', 'Codex has not reported rate-limit data yet.')
  }
  return {
    provider: 'codex',
    availability: 'available',
    health: worstUsageHealth(quotas),
    plan,
    account: null,
    quotas,
    cost: null,
    daily: null,
    capturedAt,
    stale: false,
    error: null,
  }
}

function classifyCodexOutput(text: string): UsageProcessError | null {
  const lower = text.toLowerCase()
  if (lower.includes('not logged in') || lower.includes('please log in')) {
    return new UsageProcessError('authentication_required', 'Codex is not logged in. Run `codex` and sign in.')
  }
  if (lower.includes('update available') || lower.includes('update required')) {
    return new UsageProcessError('update_required', 'Codex CLI must be updated before usage can be read.')
  }
  return null
}

function ttyPercent(label: RegExp, lines: readonly string[]): number | null {
  const start = lines.findIndex((line) => label.test(line))
  if (start < 0) return null
  for (const line of lines.slice(start, start + 12)) {
    const match = line.match(/([0-9]{1,3}(?:\.[0-9]+)?)\s*%\s*left/i)
    if (match) return clampRemaining(Number(match[1]))
  }
  return null
}

export function parseCodexTtyOutput(text: string, capturedAt = Date.now()): AgentProviderUsage {
  const classified = classifyCodexOutput(text)
  if (classified) throw classified
  const lines = text.split(/\r?\n/)
  const session = ttyPercent(/5h limit/i, lines)
  const weekly = ttyPercent(/weekly limit/i, lines)
  const quotas: AgentUsageQuota[] = [
    ...(session == null
      ? []
      : [{ id: 'session', label: 'Session (5h)', percentRemaining: session, resetsAt: null, resetText: null, health: usageHealth(session) }]),
    ...(weekly == null
      ? []
      : [{ id: 'weekly', label: 'Weekly', percentRemaining: weekly, resetsAt: null, resetText: null, health: usageHealth(weekly) }]),
  ]
  if (quotas.length === 0) throw new UsageProcessError('parse_failure', 'Codex `/status` output did not contain usage limits.')
  return {
    provider: 'codex',
    availability: 'available',
    health: worstUsageHealth(quotas),
    plan: null,
    account: null,
    quotas,
    cost: null,
    daily: null,
    capturedAt,
    stale: false,
    error: null,
  }
}

export async function collectCodexUsage(options: CodexUsageOptions): Promise<AgentProviderUsage> {
  const now = options.now ?? Date.now
  try {
    return parseCodexRpcResponse(await readCodexRateLimitsViaRpc(options.startRpc), now())
  } catch (rpcError) {
    try {
      const result = await (options.runPty ?? capturePty)({
        command: 'codex',
        args: ['-s', 'read-only', '-a', 'untrusted'],
        cwd: options.cwd,
        startupInput: '/status\r',
      })
      return parseCodexTtyOutput(result.output, now())
    } catch (ttyError) {
      if (ttyError instanceof UsageProcessError) throw ttyError
      if (rpcError instanceof UsageProcessError) throw rpcError
      throw new UsageProcessError('execution_failure', 'Codex usage could not be read.')
    }
  }
}
