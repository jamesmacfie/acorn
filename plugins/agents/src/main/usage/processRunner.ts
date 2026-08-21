import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import { spawn as spawnNodePty, type IPty } from 'node-pty'
import type { AgentUsageErrorCode } from '../../shared/usage'

const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as {
  Terminal: typeof HeadlessTerminal
}

const ENV_KEYS = ['HOME', 'PATH', 'SHELL', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'TMPDIR'] as const

export type PromptResponse = {
  pattern: RegExp
  response: string
}

export type PtyProcess = Pick<IPty, 'onData' | 'onExit' | 'write' | 'kill'>

// Grace period between the polite SIGHUP that node-pty's kill() sends and an unconditional SIGKILL.
const KILL_ESCALATION_MS = 2_000
export type PtySpawner = (
  executable: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => PtyProcess

export type PtyCaptureOptions = {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  cols?: number
  rows?: number
  scrollback?: number
  startupInput?: string
  startupInputDelayMs?: number
  promptResponses?: PromptResponse[]
  idleMs?: number
  timeoutMs?: number
  maxBytes?: number
  spawnPty?: PtySpawner
  /** Test seam: shorten the SIGHUP -> SIGKILL grace period. */
  killEscalationMs?: number
  resolveCommand?: (command: string, env: NodeJS.ProcessEnv) => string | null
}

export type PtyCaptureResult = {
  output: string
  exitCode: number | null
}

export class UsageProcessError extends Error {
  constructor(
    readonly code: AgentUsageErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'UsageProcessError'
  }
}

export function usageProcessEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ENV_KEYS) {
    const value = process.env[key]
    if (value != null) env[key] = value
  }
  return { ...env, TERM: 'xterm-256color', ...overrides }
}

export function resolveUsageCommand(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK)
      return command
    } catch {
      return null
    }
  }
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue through PATH.
    }
  }
  return null
}

function hasMeaningfulOutput(chunk: string): boolean {
  return chunk
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .trim().length > 0
}

function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0
  return pattern.test(text)
}

export async function renderTerminalCapture(
  raw: string,
  options: { cols?: number; rows?: number; scrollback?: number } = {},
): Promise<string> {
  const terminal = new Terminal({
    cols: options.cols ?? 160,
    rows: options.rows ?? 50,
    scrollback: options.scrollback ?? 2_000,
    // The headless package still marks buffer inspection as proposed in xterm
    // 5.5 even though it is the package's only way to read the rendered screen.
    allowProposedApi: true,
  })
  try {
    await new Promise<void>((resolve) => terminal.write(raw, resolve))
    const buffer = terminal.buffer.active
    const lines: string[] = []
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  } finally {
    terminal.dispose()
  }
}

export function capturePty(options: PtyCaptureOptions): Promise<PtyCaptureResult> {
  const cols = options.cols ?? 160
  const rows = options.rows ?? 50
  const idleMs = options.idleMs ?? 3_000
  const killEscalationMs = options.killEscalationMs ?? KILL_ESCALATION_MS
  const timeoutMs = options.timeoutMs ?? 20_000
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  const env = { ...usageProcessEnv(), ...options.env }
  const executable = (options.resolveCommand ?? resolveUsageCommand)(options.command, env)
  if (!executable) {
    return Promise.reject(new UsageProcessError('cli_missing', `${options.command} is not available on PATH.`))
  }

  return new Promise<PtyCaptureResult>((resolve, reject) => {
    let process: PtyProcess
    try {
      process = (options.spawnPty ?? spawnNodePty)(executable, options.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: options.cwd,
        env,
      })
    } catch (error) {
      reject(new UsageProcessError('execution_failure', error instanceof Error ? error.message : `Failed to start ${options.command}.`))
      return
    }

    let raw = ''
    let byteCount = 0
    let settled = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let startupTimer: ReturnType<typeof setTimeout> | undefined
    const answered = new Set<number>()

    const cleanup = () => {
      clearTimeout(timeoutTimer)
      if (idleTimer) clearTimeout(idleTimer)
      if (startupTimer) clearTimeout(startupTimer)
      dataDisposable.dispose()
      exitDisposable.dispose()
      if (escalation) clearTimeout(escalation)
    }

    // Two-stage teardown. node-pty's kill() sends SIGHUP, which a CLI sitting on a prompt can ignore. A
    // `claude /usage` probe was found still alive as an orphan (ppid 1) four days after the run that
    // spawned it, holding a deleted temp dir. Escalate to SIGKILL if the child has not reported exit
    // shortly after the polite signal.
    let exited = false
    let escalation: ReturnType<typeof setTimeout> | undefined

    const stop = () => {
      try {
        process.kill()
      } catch {
        return // already gone
      }
      escalation = setTimeout(() => {
        if (exited) return
        try {
          process.kill('SIGKILL')
        } catch {
          // raced with a real exit, nothing to do
        }
      }, killEscalationMs)
      escalation.unref?.()
    }

    const fail = (error: UsageProcessError) => {
      if (settled) return
      settled = true
      cleanup()
      stop()
      reject(error)
    }

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      cleanup()
      stop()
      void renderTerminalCapture(raw, { cols, rows, scrollback: options.scrollback }).then(
        (output) => resolve({ output, exitCode }),
        (error: unknown) =>
          reject(new UsageProcessError('parse_failure', error instanceof Error ? error.message : 'Could not render terminal output.')),
      )
    }

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => finish(null), idleMs)
    }

    const dataDisposable = process.onData((chunk) => {
      if (settled) return
      byteCount += Buffer.byteLength(chunk)
      if (byteCount > maxBytes) {
        fail(new UsageProcessError('output_limit', `${options.command} produced more than ${maxBytes} bytes.`))
        return
      }
      raw += chunk
      for (const [index, response] of (options.promptResponses ?? []).entries()) {
        if (!answered.has(index) && matches(response.pattern, raw)) {
          answered.add(index)
          process.write(response.response)
        }
      }
      if (hasMeaningfulOutput(chunk)) resetIdle()
    })
    const exitDisposable = process.onExit(({ exitCode }) => {
      exited = true
      if (escalation) clearTimeout(escalation)
      finish(exitCode)
    })
    const timeoutTimer = setTimeout(
      () => fail(new UsageProcessError('timeout', `${options.command} did not finish within ${timeoutMs}ms.`)),
      timeoutMs,
    )

    if (options.startupInput) {
      startupTimer = setTimeout(() => {
        if (!settled) process.write(options.startupInput!)
      }, options.startupInputDelayMs ?? 250)
    }
  })
}
