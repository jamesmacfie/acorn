// Headless step runner (docs/next 14 P1) — the single biggest new workflow capability: run an
// agent CLI to COMPLETION in a worktree and capture a structured result, modeled on the
// term:previewUrl capture (run + timeout + parse). Interactive sessions stay spawnOne's job.
//
// Argv templates per profile (the vNext §7 seam revived). Flags VERIFIED against the CLIs
// installed on this machine (2026-07-03) — the design doc's names were re-checked per the plan:
//   claude: -p --output-format stream-json --verbose --json-schema <schema> --model <m>
//           --permission-mode <mode>  (+ --resume <session_id> for continuity)
//   codex:  exec --json --output-schema <FILE> -m <m>   (schema is a FILE path, not inline)
// Agent CLIs are NEVER invoked in tests — the committed test/fixtures/fake-agent.sh stands in,
// wired through this same argv-template path.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type HeadlessMode = 'interactive' | 'headless'

export type HeadlessArgv = { file: string; args: string[] }

export type HeadlessOpts = {
  prompt: string
  model?: string
  schema?: object // JSON schema for structured output
  resumeSessionId?: string
}

// Build the non-interactive invocation for a profile. `command` is injectable so tests route the
// same template through the fake agent script.
export function buildHeadlessArgv(profileId: string, command: string, opts: HeadlessOpts): HeadlessArgv | null {
  if (profileId === 'claude-code') {
    return {
      file: command,
      args: [
        ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
        '-p',
        '--output-format',
        'stream-json',
        '--verbose', // stream-json in -p mode requires it
        '--permission-mode',
        'dontAsk', // pre-authorized so a headless step never blocks (14 §crux)
        ...(opts.model ? ['--model', opts.model] : []),
        ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : []),
        opts.prompt,
      ],
    }
  }
  if (profileId === 'codex') {
    const schemaFile = opts.schema ? materializeSchema(opts.schema) : null
    return {
      file: command,
      args: ['exec', '--json', ...(opts.model ? ['-m', opts.model] : []), ...(schemaFile ? ['--output-schema', schemaFile] : []), opts.prompt],
    }
  }
  return null // shells/aider have no headless mode
}

// codex takes --output-schema as a file path; write the schema to a tmp file.
function materializeSchema(schema: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-schema-'))
  const file = join(dir, 'schema.json')
  writeFileSync(file, JSON.stringify(schema), 'utf8')
  return file
}

// --- Stream-json parsing (pure). claude's -p stream: one JSON object per line; the final
// `type: "result"` event carries result/session_id/cost and (with --json-schema) the structured
// output. Unknown lines are kept as raw events — the Agents-panel feed (15) renders them.
export type StreamEvent = Record<string, unknown> & { type?: string }

export type HeadlessCapture = {
  result: string | null
  structuredOutput: unknown | null
  sessionId: string | null
  costUsd: number | null
  events: StreamEvent[]
}

export function parseStreamJson(stdout: string): HeadlessCapture {
  const events: StreamEvent[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed) as StreamEvent)
    } catch {
      // non-JSON noise (progress bars etc.) — not an event
    }
  }
  const resultEvent = [...events].reverse().find((e) => e.type === 'result')
  return {
    result: typeof resultEvent?.result === 'string' ? resultEvent.result : null,
    structuredOutput: resultEvent && 'structured_output' in resultEvent ? (resultEvent.structured_output ?? null) : null,
    sessionId: typeof resultEvent?.session_id === 'string' ? resultEvent.session_id : null,
    costUsd: typeof resultEvent?.total_cost_usd === 'number' ? resultEvent.total_cost_usd : typeof resultEvent?.cost_usd === 'number' ? resultEvent.cost_usd : null,
    events,
  }
}

// --- The runner ---

export type HeadlessResult = {
  status: 'ok' | 'error' | 'timeout' | 'malformed'
  exitCode: number | null
  capture: HeadlessCapture
  stderrTail: string
}

export const HEADLESS_TIMEOUT_MS = 10 * 60 * 1000

export function runHeadless(
  argv: HeadlessArgv,
  opts: { cwd: string; env: Record<string, string>; timeoutMs?: number },
): Promise<HeadlessResult> {
  return new Promise((resolve) => {
    // detached → own process group, so the timeout kill reaps grandchildren too (a hung agent's
    // own children would otherwise hold the stdio pipes open and stall the 'close' event).
    const child = spawn(argv.file, argv.args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, opts.timeoutMs ?? HEADLESS_TIMEOUT_MS)
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ status: 'error', exitCode: null, capture: parseStreamJson(''), stderrTail: err.message })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const capture = parseStreamJson(stdout)
      const stderrTail = stderr.slice(-2000)
      if (timedOut) return resolve({ status: 'timeout', exitCode, capture, stderrTail })
      if (exitCode !== 0) return resolve({ status: 'error', exitCode, capture, stderrTail })
      // Exit 0 but no result event → the output is unusable for edges: a typed error, not a guess.
      if (capture.result == null && capture.structuredOutput == null) return resolve({ status: 'malformed', exitCode, capture, stderrTail })
      resolve({ status: 'ok', exitCode, capture, stderrTail })
    })
  })
}
