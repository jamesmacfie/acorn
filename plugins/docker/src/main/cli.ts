// The one seam to the docker CLI: execFile with arg arrays (no shell), timeouts, and a typed
// failure taxonomy. Talking to the CLI (not the socket) keeps this working identically across
// Docker Desktop / OrbStack / colima — whatever `docker context` points at.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { brokerEnv } from '@acorn/node-core/main/core/proc.ts'

const exec = promisify(execFile)

// The env the docker CLI sees. This was a DENYLIST of six known secret names, whose "keep in sync"
// comment pointed at plugins/terminal/main/executionService.ts — a file that no longer exists. A
// denylist leaks every binding nobody remembered to add to it, so it is now the broker's allowlist
// (CoreServices.proc) plus the DOCKER_*/COMPOSE_* configuration the CLI genuinely needs to find the
// daemon: DOCKER_HOST and DOCKER_CONTEXT are how OrbStack/colima/Desktop differ.
export function dockerEnv(): NodeJS.ProcessEnv {
  return brokerEnv({
    passthrough: [
      'DOCKER_*',
      'COMPOSE_*',
      'XDG_CONFIG_HOME',
      // A denylist kept these by accident; an allowlist has to name them. Without the proxy vars
      // `docker pull` fails behind a corporate proxy, and without the cloud ones the ECR/GCR credential
      // helpers cannot authenticate — both are configuration the CLI needs, not acorn's secrets.
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'no_proxy',
      'AWS_*',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'KUBECONFIG',
    ],
  })
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
