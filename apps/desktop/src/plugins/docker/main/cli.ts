// The one seam to the docker CLI: execFile with arg arrays (no shell), timeouts, and a typed
// failure taxonomy. Talking to the CLI (not the socket) keeps this working identically across
// Docker Desktop / OrbStack / colima — whatever `docker context` points at.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

// Same posture as the terminal execution service: never leak acorn's own secrets into children.
// ponytail: keep in sync with plugins/terminal/main/executionService.ts SECRET_ENV_KEYS (frozen plugin boundary).
const SECRET_ENV_KEYS = new Set(['INTERNAL_TOKEN', 'SESSION_ENC_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ACORN_API_TOKEN', 'ACORN_INTERNAL_TOKEN'])

export function dockerEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!SECRET_ENV_KEYS.has(k)) out[k] = v
  return out
}

export type DockerCliFailure = 'not_installed' | 'daemon_down' | 'failed'

export class DockerCliError extends Error {
  readonly kind: DockerCliFailure
  readonly exitCode: number | null
  readonly stderr: string
  constructor(kind: DockerCliFailure, message: string, exitCode: number | null = null, stderr = '') {
    super(message)
    this.name = 'DockerCliError'
    this.kind = kind
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

const DAEMON_DOWN_RE = /cannot connect to the docker daemon|docker daemon is not running|error during connect/i

type ExecErr = { code?: number | string; killed?: boolean; stdout?: string; stderr?: string; message?: string }

// Run `docker <args>` and return stdout. Failures become DockerCliError so callers branch on kind.
export async function docker(args: string[], opts: { timeout?: number; maxBuffer?: number } = {}): Promise<string> {
  try {
    const { stdout } = await exec('docker', args, {
      timeout: opts.timeout ?? 20_000,
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
      env: dockerEnv(),
    })
    return stdout
  } catch (err) {
    const e = err as ExecErr
    if (e.code === 'ENOENT') throw new DockerCliError('not_installed', 'docker CLI not found on PATH')
    const stderr = (e.stderr ?? '').trim()
    if (DAEMON_DOWN_RE.test(stderr)) throw new DockerCliError('daemon_down', 'docker daemon is not reachable', null, stderr)
    const exitCode = typeof e.code === 'number' ? e.code : null
    const tail = stderr.split('\n').slice(-4).join('\n')
    throw new DockerCliError('failed', tail || (e.killed ? `docker ${args[0]} timed out` : e.message ?? 'docker command failed'), exitCode, stderr)
  }
}
