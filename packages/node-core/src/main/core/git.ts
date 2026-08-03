// The one git seam. Before this, `promisify(execFile)('git', …)` appeared at ~15 sites across
// changes, github, editor, memory and core's worktrees.ts, each picking its own timeout (10s/15s/30s/
// 60s) and maxBuffer (1 MiB–50 MiB) — and, more importantly, each inheriting whatever env hygiene
// that site happened to have.
//
// Two behaviours this adds that no individual call site had:
//
//   - GIT_TERMINAL_PROMPT=0. A fetch against a repo whose credentials have expired would otherwise
//     block on a username prompt until the caller's timeout, turning a fast auth failure into a
//     30-second hang.
//   - SSH_AUTH_SOCK in the passthrough. It is NOT in the base allowlist (childEnv), so a push over
//     ssh would fail with "agent refused operation" once git went through the broker. This is the one
//     credential-adjacent variable git genuinely needs, and it grants use of the agent, not a
//     readable secret.
import { runProcess, runProcessOrThrow, type ProcResult } from './proc'

// Most git reads are small; `git diff` on a large change is the exception, so the cap is generous
// while still bounded. Was 1 MiB at some sites, which silently truncated big diffs.
export const GIT_MAX_OUTPUT_BYTES = 16 << 20
export const GIT_TIMEOUT_MS = 30_000

export type GitOptions = {
  cwd: string
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  env?: Record<string, string>
  stdin?: string
}

const spec = (args: readonly string[], opts: GitOptions) => ({
  file: 'git',
  args,
  cwd: opts.cwd,
  env: { GIT_TERMINAL_PROMPT: '0', ...(opts.env ?? {}) },
  passthrough: ['GIT_*', 'SSH_AUTH_SOCK', 'XDG_CONFIG_HOME'] as const,
  timeoutMs: opts.timeoutMs ?? GIT_TIMEOUT_MS,
  maxOutputBytes: opts.maxOutputBytes ?? GIT_MAX_OUTPUT_BYTES,
  signal: opts.signal,
  stdin: opts.stdin,
})

// Exit code is data: `git diff --quiet` and `git merge-tree` both use it to answer a question.
export const git = (args: readonly string[], opts: GitOptions): Promise<ProcResult> => runProcess(spec(args, opts))

// For the callers that treat a non-zero exit as an error.
export const gitOrThrow = (args: readonly string[], opts: GitOptions): Promise<ProcResult> => runProcessOrThrow(spec(args, opts))

// stdout of a successful command, trimmed — the shape most call sites actually wanted.
export const gitText = async (args: readonly string[], opts: GitOptions): Promise<string> => (await gitOrThrow(args, opts)).stdout.trim()
