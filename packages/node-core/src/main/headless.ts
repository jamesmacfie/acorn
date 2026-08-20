// Headless step runner (docs/workflows.md): run an agent CLI to completion in a worktree and capture a
// structured result, modelled on the term:previewUrl capture of run, timeout and parse. Interactive
// sessions stay spawnOne's job.
//
// Argv templates per profile. Flags verified against the CLIs installed on this machine (2026-07-03):
//   claude: -p --output-format stream-json --verbose --json-schema <schema> --model <m>
//           --permission-mode <mode>, plus --resume <session_id> for continuity
//   codex:  exec --json --output-schema <FILE> -m <m>, where the schema is a file path, not inline
//
// Agent CLIs are never invoked in tests: the committed test/fixtures/fake-agent.sh stands in, wired
// through this same argv-template path.
import { spawn } from 'node:child_process'
import { lineDelimitedJsonAdapter, parseStreamJson } from './agentProfiles/streamJson'
import type { HeadlessArgv, HeadlessCapture, HeadlessOpts, StreamEvent, StreamJsonAdapter } from './agentProfiles'
import { requireProfile } from './profiles'

export type HeadlessMode = 'interactive' | 'headless'

export type { HeadlessArgv, HeadlessCapture, HeadlessOpts, StreamEvent }

// Build the non-interactive invocation for a profile. `command` is injectable so tests route the same
// template through the fake agent script.
export function buildHeadlessArgv(profileId: string, command: string, opts: HeadlessOpts): HeadlessArgv | null {
  return requireProfile(profileId).headlessArgv?.(command, opts) ?? null
}

// --- Stream-json parsing, pure. claude's -p stream is one JSON object per line; the final
// `type: "result"` event carries result, session_id, cost and, with --json-schema, the structured
// output. Unknown lines are kept as raw events, which the Agents panel feed renders.
export { parseStreamJson }

// --- The runner ---

export type HeadlessResult = {
  status: 'ok' | 'error' | 'timeout' | 'malformed' | 'cancelled'
  exitCode: number | null
  capture: HeadlessCapture
  stderrTail: string
  // Present when the workflow step ran through the durable managed-agent runtime. Kept outside
  // HeadlessCapture because capture.sessionId is the provider's resume reference.
  agentSessionId?: string
}

export const HEADLESS_TIMEOUT_MS = 10 * 60 * 1000

export function runHeadless(
  argv: HeadlessArgv,
  opts: { cwd: string; env: Record<string, string>; timeoutMs?: number; signal?: AbortSignal; onEvent?: (event: StreamEvent) => void; adapter?: StreamJsonAdapter },
): Promise<HeadlessResult> {
  return new Promise((resolve) => {
    const adapter = opts.adapter ?? lineDelimitedJsonAdapter
    // detached gives it its own process group, so the timeout kill reaps grandchildren too. A hung
    // agent's own children would otherwise hold the stdio pipes open and stall the 'close' event.
    const child = spawn(argv.file, argv.args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let stdout = ''
    let lineBuffer = ''
    let stderr = ''
    let timedOut = false
    let cancelled = false
    let settled = false
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, opts.timeoutMs ?? HEADLESS_TIMEOUT_MS)
    const abort = () => {
      cancelled = true
      kill()
    }
    if (opts.signal?.aborted) abort()
    else opts.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (c: Buffer) => {
      const chunk = c.toString()
      stdout += chunk
      lineBuffer += chunk
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const event = adapter.parseLine(line)
        if (event) opts.onEvent?.(event)
      }
    })
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', abort)
      resolve({ status: cancelled ? 'cancelled' : 'error', exitCode: null, capture: adapter.parse(''), stderrTail: err.message })
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', abort)
      if (lineBuffer) {
        const event = adapter.parseLine(lineBuffer)
        if (event) opts.onEvent?.(event)
      }
      const capture = adapter.parse(stdout)
      const stderrTail = stderr.slice(-2000)
      if (cancelled) return resolve({ status: 'cancelled', exitCode, capture, stderrTail })
      if (timedOut) return resolve({ status: 'timeout', exitCode, capture, stderrTail })
      if (exitCode !== 0) return resolve({ status: 'error', exitCode, capture, stderrTail })
      // Exit 0 with no result event means output that's unusable for edges: a typed error, not a guess.
      if (capture.result == null && capture.structuredOutput == null) return resolve({ status: 'malformed', exitCode, capture, stderrTail })
      resolve({ status: 'ok', exitCode, capture, stderrTail })
    })
  })
}
