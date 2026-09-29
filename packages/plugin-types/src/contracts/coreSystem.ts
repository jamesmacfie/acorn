import type { HostOwned } from './shared.js'

export type CoreFsService = {
  isContainedPath(root: string, candidate: string): boolean
  isValidRepoIdent(value: string): boolean
  /** The absolute path, or `null` when `relPath` is absolute or escapes `root`. */
  resolveInRoot(root: string, relPath: string): string | null
  confineExistingFile(root: string, relPath: string): Promise<ConfineResult>
}

export type ConfineFailure = 'absolute' | 'escapes' | 'missing' | 'not-file'
export type ConfineResult = { ok: true; path: string } | { ok: false; reason: ConfineFailure }

/** The one git seam: `GIT_TERMINAL_PROMPT=0`, `SSH_AUTH_SOCK` passed through, output bounded. */
export type CoreGitService = {
  GIT_MAX_OUTPUT_BYTES: number
  GIT_TIMEOUT_MS: number
  git(args: readonly string[], opts: GitOptions): Promise<ProcResult>
  gitOrThrow(args: readonly string[], opts: GitOptions): Promise<ProcResult>
  gitText(args: readonly string[], opts: GitOptions): Promise<string>
}

export type GitOptions = {
  /** Absolute, and required. An inherited cwd is how a task-scoped command runs against the wrong
   *  checkout. */
  cwd: string
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  env?: Record<string, string>
  stdin?: string
}

/** Every child process: env allowlist, process-group kill, bounded capture. */
export type CoreProcService = {
  DEFAULT_MAX_OUTPUT_BYTES: number
  DEFAULT_TIMEOUT_MS: number
  KILL_GRACE_MS: number
  /** The environment a child will actually see: the allowlisted base, plus this spec's `env` and
   *  `passthrough`. Everything else is absent, including every `ACORN_*` token and every secret. */
  brokerEnv(spec: Pick<ProcSpec, 'env' | 'passthrough'>, parent?: Record<string, string | undefined>): Record<string, string>
  runProcess(spec: ProcSpec): Promise<ProcResult>
  runProcessOrThrow(spec: ProcSpec): Promise<ProcResult>
  ProcessError: HostOwned<'node-core/server/core/exec/proc.ProcessError'>
}

export type ProcSpec = {
  file: string
  args?: readonly string[]
  /** Absolute, and required. See GitOptions.cwd. */
  cwd: string
  /** Merged over the allowlisted base. */
  env?: Record<string, string>
  /** Exact names or `PREFIX_*` globs to carry over from the parent environment as well. For tool
   *  configuration (`DOCKER_HOST`, `GIT_*`), never for credentials. */
  passthrough?: readonly string[]
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  stdin?: string
  /** How long a group member gets between SIGTERM and SIGKILL. */
  killGraceMs?: number
}

export type ProcResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** At least one stream hit `maxOutputBytes`. The process was not killed for it. */
  truncated: boolean
  /** Set when the process could not be started at all, such as ENOENT for a missing binary. This is
   *  what lets a caller say "docker is not installed" rather than "docker failed". */
  spawnError: string | null
}

/** Use-scoped credential access. There is no "read this secret" call on this surface, and there will
 *  not be one: the plaintext is scoped to a callback and scrubbed out of anything thrown from it. */
export type CoreSecretService = HostOwned<'node-core/server/core/security/secrets.SecretService'> & {
  use<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T>
  useOptional<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T | null>
  seal(plaintext: string): Promise<string>
}

/** Task facts plugins need. Never the row, and never a database handle. */
