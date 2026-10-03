// The one git seam. Before this, `promisify(execFile)('git', …)` appeared at about 15 sites across
// changes, github, editor, memory and core's worktrees.ts, each picking its own timeout and maxBuffer,
// and each inheriting whatever env hygiene that site happened to have.
//
// Two behaviours this adds that no individual call site had:
//
//   GIT_TERMINAL_PROMPT=0. A fetch against a repo whose credentials have expired would otherwise block
//   on a username prompt until the caller's timeout, turning a fast auth failure into a 30-second hang.
//
//   SSH_AUTH_SOCK in the passthrough. It isn't in the base allowlist (childEnv), so a push over ssh
//   would fail with "agent refused operation" once git went through the broker. It grants use of the
//   agent, not a readable secret.
import { existsSync } from 'node:fs'
import { measure } from '../telemetry/collector'
import { ProcessError, runProcess, runProcessOrThrow, type ProcResult } from './proc'

// Most git reads are small; `git diff` on a large change is the exception, so the cap is generous while
// still bounded. Was 1 MiB at some sites, which silently truncated big diffs.
export const GIT_MAX_OUTPUT_BYTES = 16 << 20
export const GIT_TIMEOUT_MS = 30_000

export type GitOptions = {
  cwd: string
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  env?: Record<string, string>
  stdin?: string
  // For commands such as diff --no-index, where 1 means a complete answer with differences.
  // Output, deadline, cancellation, and spawn failures still throw.
  allowedExitCodes?: readonly number[]
}

const spec = (args: readonly string[], opts: GitOptions) => ({
  file: 'git',
  args,
  cwd: opts.cwd,
  env: { GIT_TERMINAL_PROMPT: '0', ...opts.env },
  // Proxy and GPG entries aren't optional extras: an allowlist that omits them silently breaks
  // `git fetch` behind a corporate proxy and every signed commit.
  passthrough: [
    'GIT_*',
    'SSH_AUTH_SOCK',
    'XDG_CONFIG_HOME',
    'GNUPGHOME',
    'GPG_TTY',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ] as const,
  timeoutMs: opts.timeoutMs ?? GIT_TIMEOUT_MS,
  maxOutputBytes: opts.maxOutputBytes ?? GIT_MAX_OUTPUT_BYTES,
  signal: opts.signal,
  stdin: opts.stdin,
})

// Apple's /usr/bin/git is an Xcode selector. After an Xcode update it can refuse every command
// until that installation's license is accepted, even when the standalone Command Line Tools Git
// is installed and usable. Retry only that specific failure; all other Git errors still belong to
// the selected executable and must reach the caller unchanged.
const commandLineToolsGit = '/Library/Developer/CommandLineTools/usr/bin/git'
const xcodeLicenseBlocked = (result: ProcResult): boolean =>
  process.platform === 'darwin'
  && result.code === 69
  && /You have not agreed to the Xcode license agreements/.test(result.stderr)
  && existsSync(commandLineToolsGit)

// A histogram per subcommand rather than per argument list: a status ping spawns `git status` and
// two `git diff` per active worktree per connected client and nothing counted them, which is the
// measurement phase 5 of the performance programme argues from (../telemetry/collector.ts).
//
// A histogram and not a span, because this fires far more than ten times a second under normal use
// (docs/telemetry/model.md § Hot seams are metrics). `measure` is a straight passthrough when nothing is
// collecting.
//
// `'core'` is what this file can honestly say: it is reached from every route, every schedule and
// every plugin and knows nothing about its caller. The ambient context knows, and `measure` reads
// it, so a spawn under `/v1/p/github` reports as github's without a signature here changing
// (../telemetry/context.ts, docs/telemetry/runtimes.md § Ambient attribution).
const seam = (args: readonly string[]) => `git.${args[0] ?? 'unknown'}`

// Exit code is data: `git diff --quiet` and `git merge-tree` both use it to answer a question.
export const git = (args: readonly string[], opts: GitOptions): Promise<ProcResult> =>
  measure('core', seam(args), async () => {
    const command = spec(args, opts)
    const result = await runProcess(command)
    return xcodeLicenseBlocked(result)
      ? runProcess({ ...command, file: commandLineToolsGit })
      : result
  })

// For the callers that treat a non-zero exit as an error.
export const gitOrThrow = (args: readonly string[], opts: GitOptions): Promise<ProcResult> =>
  measure('core', seam(args), async () => {
    const command = spec(args, opts)
    try {
      return await runProcessOrThrow(command, opts.allowedExitCodes)
    } catch (error) {
      if (!(error instanceof ProcessError) || !xcodeLicenseBlocked(error.result)) throw error
      return runProcessOrThrow({ ...command, file: commandLineToolsGit }, opts.allowedExitCodes)
    }
  })

// stdout of a successful command, trimmed, which is the shape most call sites wanted.
export const gitText = async (args: readonly string[], opts: GitOptions): Promise<string> => (await gitOrThrow(args, opts)).stdout.trim()
