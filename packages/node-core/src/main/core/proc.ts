// The process broker (docs/vNext/security.md § Execution boundaries): "All child processes go
// through the process broker: explicit cwd inside the task worktree (or a declared exception), env
// allowlists (no ambient ACORN_* tokens), process-group kill, bounded output capture."
//
// Before this existed there were ~16 independent spawn/execFile sites with inconsistent behaviour,
// and the inconsistency was not cosmetic:
//
//   - plugins/terminal's previewUrl ran `execFile('/bin/sh', ['-c', script])` with NO `env` option,
//     so a repo-configured capture command inherited the node's entire environment — SESSION_ENC_KEY
//     and INTERNAL_TOKEN included — and with no maxBuffer.
//   - plugins/agents' claudeDriver spawned with `{ ...process.env, ...options.env }`, same leak.
//   - plugins/docker filtered secrets with a DENYLIST of six known names, whose "keep in sync"
//     comment pointed at a file that no longer exists. A denylist leaks every binding nobody thought
//     to add to it.
//   - exactly one site (main/headless.ts) killed the process GROUP; everywhere else a hung child's
//     grandchildren survived, holding the stdio pipes open.
//
// So the env is built from an ALLOWLIST here and `process.env` is never spread. A caller that needs
// more than the allowlist declares it (`passthrough: ['DOCKER_*']`) — visible in the call, reviewable,
// and additive rather than "everything except what we remembered".
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { childEnv } from '../taskEnv'

// Per stream, not combined: matches the cap plugins/http already enforces on command variables.
export const DEFAULT_MAX_OUTPUT_BYTES = 1 << 20
export const DEFAULT_TIMEOUT_MS = 30_000
// SIGTERM lets a shell run its traps and a compose stack stop its containers; SIGKILL after this
// stops a process that ignores it from wedging the caller forever.
export const KILL_GRACE_MS = 2_000

export type ProcSpec = {
  file: string
  args?: readonly string[]
  // Required, and required to be absolute by the callers that have a worktree: an inherited cwd is
  // how a task-scoped command ends up running against the wrong checkout.
  cwd: string
  // Merged OVER the allowlisted base. Callers pass buildSessionEnv() output here; applying childEnv
  // twice is idempotent.
  env?: Record<string, string>
  // Exact names or `PREFIX_*` globs to carry over from the parent environment in addition to the
  // base allowlist. Use for tool configuration (DOCKER_HOST, GIT_*), never for credentials.
  passthrough?: readonly string[]
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  stdin?: string
  // How long a group member gets between SIGTERM and SIGKILL. Overridable mainly so the escalation path
  // can be tested deterministically under load — a 2s default plus scheduling makes a full-suite run
  // flaky, and loosening the ASSERTION instead would be testing nothing.
  killGraceMs?: number
}

export type ProcResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  // At least one stream hit maxOutputBytes. The process was NOT killed for it — some callers want
  // the side effect to complete and only sample the output.
  truncated: boolean
  // Set when the process could not be started at all (ENOENT for a missing binary). Distinguishing
  // this from "ran and failed" is what lets a caller say "docker is not installed".
  spawnError: string | null
}

// Which parent variables a child may see. Everything not named here is absent, including every
// ACORN_* token the node injects into its own process and every secret binding.
export function brokerEnv(spec: Pick<ProcSpec, 'env' | 'passthrough'>, parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out = childEnv(parent)
  for (const rule of spec.passthrough ?? []) {
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1)
      // A bare '*' would copy the whole parent environment, secrets included — i.e. quietly restore the
      // behaviour this allowlist exists to remove. Refuse it rather than trust that no caller writes it.
      if (!prefix) throw new Error("brokerEnv passthrough must name a prefix; a bare '*' would defeat the allowlist.")
      for (const [key, value] of Object.entries(parent)) if (key.startsWith(prefix) && value) out[key] = value
    } else {
      const value = parent[rule]
      if (value) out[rule] = value
    }
  }
  return { ...out, ...(spec.env ?? {}) }
}

// Never rejects on a non-zero exit: the exit code is data, and every current call site branches on it
// anyway. Only a programming error (bad spec) can throw.
export function runProcess(spec: ProcSpec): Promise<ProcResult> {
  const maxOutputBytes = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  return new Promise((resolve) => {
    // detached → its own process group, so the kill below reaps grandchildren too. A `sh -c` wrapper
    // that spawns a dev server is the normal case here, not the exotic one.
    const child = spawn(spec.file, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: brokerEnv(spec),
      stdio: [spec.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      detached: true,
    })

    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false
    let escalation: NodeJS.Timeout | null = null

    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        // Negative pid = the whole group. Falls back to the direct child if the group is already
        // gone (ESRCH) or the platform refuses.
        if (child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          // Already dead. Nothing to do.
        }
      }
    }

    const killTree = (): void => {
      signalGroup('SIGTERM')
      escalation ??= setTimeout(() => signalGroup('SIGKILL'), spec.killGraceMs ?? KILL_GRACE_MS)
      escalation.unref?.()
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    const abort = (): void => {
      aborted = true
      killTree()
    }
    if (spec.signal?.aborted) abort()
    else spec.signal?.addEventListener('abort', abort, { once: true })

    // Bytes first, decode once at the end.
    //
    // Decoding each chunk with `chunk.toString()` corrupts any multi-byte character that straddles a
    // pipe chunk boundary — a 64 KiB read can split a 3-byte character in half and each half decodes to
    // U+FFFD. Every call site this broker replaced used execFile, which sets stream.setEncoding('utf8')
    // and therefore carries partial sequences across chunks via a StringDecoder; the first version of
    // this function did not, and silently mangled `git show` file bodies and `git diff` patches over
    // 64 KiB. Confirmed: 40 000 box-drawing characters came back with three replacement characters.
    //
    // Accumulating Buffers also makes the cap exact. Slicing a decoded STRING to a byte length cut
    // mid-character, so the result could exceed maxOutputBytes and end in U+FFFD; slicing the byte
    // stream cannot overshoot.
    const buffers: { out: Buffer[]; err: Buffer[] } = { out: [], err: [] }
    const sizes = { out: 0, err: 0 }
    const capture = (which: 'out' | 'err', chunk: Buffer): void => {
      const remaining = maxOutputBytes - sizes[which]
      if (remaining <= 0) {
        truncated = true
        return
      }
      if (chunk.byteLength > remaining) {
        truncated = true
        buffers[which].push(chunk.subarray(0, remaining))
        sizes[which] = maxOutputBytes
        return
      }
      buffers[which].push(chunk)
      sizes[which] += chunk.byteLength
    }
    child.stdout?.on('data', (chunk: Buffer) => capture('out', chunk))
    child.stderr?.on('data', (chunk: Buffer) => capture('err', chunk))

    if (spec.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        // A process that exits without reading stdin gives EPIPE. Its exit code is the real answer.
      })
      child.stdin.end(spec.stdin)
    }

    const settle = (result: Omit<ProcResult, 'stdout' | 'stderr' | 'timedOut' | 'aborted' | 'truncated'>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // The SIGKILL escalation is NOT cleared here. The direct child exiting is exactly the case where a
      // group member that ignored SIGTERM is still alive: its parent is gone, the pipes closed, 'close'
      // fired — and clearing the timer at that moment left the survivor running forever. Confirmed with
      // a grandchild that traps TERM. The timer is unref'd, so letting it run costs nothing and cannot
      // hold the process open.
      spec.signal?.removeEventListener('abort', abort)
      resolve({
        ...result,
        stdout: decode(buffers.out),
        stderr: decode(buffers.err),
        timedOut,
        aborted,
        truncated,
      })
    }

    child.on('error', (error: NodeJS.ErrnoException) => {
      settle({ code: null, signal: null, spawnError: error.code ?? error.message })
    })
    child.on('close', (code, signal) => {
      settle({ code, signal, spawnError: null })
    })
  })
}

// Decode accumulated chunks as one stream. StringDecoder carries a partial multi-byte sequence across
// chunk boundaries, which is the property `chunk.toString()` lacked; and `.end()` is deliberately NOT
// called, so a sequence left incomplete by the output cap is DROPPED rather than flushed as U+FFFD.
// Dropping it is what keeps the result both valid UTF-8 and within maxOutputBytes.
function decode(chunks: readonly Buffer[]): string {
  const decoder = new StringDecoder('utf8')
  let out = ''
  for (const chunk of chunks) out += decoder.write(chunk)
  return out
}

export class ProcessError extends Error {
  constructor(
    readonly result: ProcResult,
    message: string,
  ) {
    super(message)
    this.name = 'ProcessError'
  }
}

// For the majority of call sites, which want stdout or an exception. `stderr` is truncated in the
// message because it can be long, and because a failing command's stderr is the one place a
// credential passed on a command line would surface.
export async function runProcessOrThrow(spec: ProcSpec): Promise<ProcResult> {
  const result = await runProcess(spec)
  if (result.spawnError) throw new ProcessError(result, `${spec.file}: ${result.spawnError}`)
  if (result.timedOut) throw new ProcessError(result, `${spec.file} timed out after ${spec.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)
  // Truncation is a FAILURE for a caller that wanted the whole output. execFile used to raise ENOBUFS
  // past maxBuffer, loudly; silently returning a truncated file body or patch is worse than either, and
  // git.ts's own comment promises byte-exactness. A caller that only samples output uses runProcess()
  // and reads `truncated` itself.
  if (result.truncated) {
    throw new ProcessError(result, `${spec.file} produced more than ${spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES} bytes of output`)
  }
  if (result.code !== 0) {
    throw new ProcessError(result, `${spec.file} exited ${result.code ?? result.signal}: ${result.stderr.trim().slice(0, 500)}`)
  }
  return result
}
