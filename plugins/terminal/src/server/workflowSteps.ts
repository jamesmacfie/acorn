// This plugin's two workflow step kinds and its command policy (docs/terminal/run-targets.md §
// Workflow steps).
//
// They live here rather than in the workflows plugin for the reason the http step gives: everything a
// command needs to run safely is already in this package — the process broker's environment
// allowlist, the checkout resolution, the run-target service and its trust gate. A second copy in
// workflows would be a worse one.
//
// `terminal:command` runs a captured child process, not a PTY. Capturing a clean stdout out of a PTY
// is lossy, and a headless node with nobody attached would still have to hold the terminal open.
import { buildSessionEnv, type CoreServices } from '@acorn/plugin-api/node'
import type { StepField, TerminalWorkflowPolicy, TerminalWorkflowStepKind } from '../contract/workflowSteps'
import type { TerminalRunTargets } from '../contract/runTargets'

// The point id and the shapes these two kinds are written against live in ../contract/workflowSteps.ts,
// which says why they are declared here rather than imported from plugins/workflows.

export const COMMAND_TIMEOUT_MS = 120_000
const MIN_COMMAND_TIMEOUT_MS = 1_000
export const MAX_COMMAND_TIMEOUT_MS = 600_000
/** How long `waitForUrl` waits for a run target to report one before giving up. */
const RUN_TARGET_URL_TIMEOUT_MS = 60_000
const URL_POLL_MS = 1_000
/** What a failed command's error says. Enough to read, short enough to sit in a run list. */
const ERROR_TAIL = 300

type CommandConfig = { command?: unknown; timeoutMs?: unknown; allowFailure?: unknown; env?: unknown }
type RunTargetConfig = { target?: unknown; waitForUrl?: unknown }

const COMMAND_FIELDS: StepField[] = [
  {
    id: 'command',
    label: 'Command',
    type: 'textarea',
    required: true,
    templates: true,
    placeholder: 'pnpm test',
    hint: 'Run with /bin/sh -c in the task’s checkout.',
  },
  {
    id: 'timeoutMs',
    label: 'Timeout',
    type: 'number',
    min: MIN_COMMAND_TIMEOUT_MS,
    max: MAX_COMMAND_TIMEOUT_MS,
    hint: `Milliseconds. Defaults to ${COMMAND_TIMEOUT_MS}.`,
  },
  {
    id: 'allowFailure',
    label: 'Allow failure',
    type: 'boolean',
    hint: 'A non-zero exit becomes an answer the next step can read, not a failed run.',
  },
  {
    id: 'env',
    label: 'Environment',
    type: 'textarea',
    hint: 'One KEY=value per line, added to the allowed environment. Never put a secret here: a workflow file is committed.',
  },
]

const RUN_TARGET_FIELDS: StepField[] = [
  {
    id: 'target',
    label: 'Run target',
    type: 'select',
    required: true,
    optionsRoute: '/v1/p/terminal/tasks/{taskId}/run-targets',
  },
  {
    id: 'waitForUrl',
    label: 'Wait for a URL',
    type: 'boolean',
    hint: `On by default: the step finishes when the target reports a URL, or fails after ${RUN_TARGET_URL_TIMEOUT_MS / 1000} seconds.`,
  },
]

/** `KEY=value` per line. A line without an `=` is a mistake worth naming rather than dropping. */
export function parseEnvLines(text: string): { env: Record<string, string>; problems: string[] } {
  const env: Record<string, string> = {}
  const problems: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    const name = at > 0 ? trimmed.slice(0, at).trim() : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      problems.push(`'${trimmed.slice(0, 40)}' is not a KEY=value line`)
      continue
    }
    env[name] = trimmed.slice(at + 1).trim()
  }
  return { env, problems }
}

/** What is wrong with a command's settings, without a label, for the step kind and the policy alike. */
function commandProblems(config: CommandConfig): string[] {
  const errors: string[] = []
  if (typeof config.command !== 'string' || !config.command.trim()) errors.push('has no command')
  if (config.timeoutMs !== undefined) {
    const timeout = config.timeoutMs
    if (
      typeof timeout !== 'number' ||
      !Number.isFinite(timeout) ||
      timeout < MIN_COMMAND_TIMEOUT_MS ||
      timeout > MAX_COMMAND_TIMEOUT_MS
    ) {
      errors.push(`timeout must be between ${MIN_COMMAND_TIMEOUT_MS} and ${MAX_COMMAND_TIMEOUT_MS} milliseconds`)
    }
  }
  if (config.allowFailure !== undefined && typeof config.allowFailure !== 'boolean')
    errors.push('allowFailure must be true or false')
  if (config.env !== undefined) {
    if (typeof config.env !== 'string') errors.push('env must be KEY=value lines')
    else for (const problem of parseEnvLines(config.env).problems) errors.push(`env: ${problem}`)
  }
  return errors
}

const validateCommand: TerminalWorkflowStepKind['validate'] = (step, { label }) =>
  commandProblems((step.with ?? {}) as CommandConfig).map((problem) => `${label} ${problem}`)

const validateRunTarget: TerminalWorkflowStepKind['validate'] = (step, { label }) => {
  const config = (step.with ?? {}) as RunTargetConfig
  const errors: string[] = []
  // Which targets exist is a property of the task's checkout, so it is checked when the step runs and
  // not here: a definition is validated on a node that may not have the repository at all.
  if (typeof config.target !== 'string' || !config.target.trim()) errors.push(`${label} has no run target`)
  if (config.waitForUrl !== undefined && typeof config.waitForUrl !== 'boolean')
    errors.push(`${label} waitForUrl must be true or false`)
  return errors
}

type CommandCore = Pick<CoreServices, 'tasks' | 'projects' | 'proc'>
type ProcessResult = Awaited<ReturnType<CommandCore['proc']['runProcess']>>
type CommandRun =
  | { error: string }
  | {
      result: ProcessResult
      timeoutMs: number
      structured: { exitCode: ProcessResult['code']; stdout: string; stderr: string; truncated: boolean }
    }

/** Runs one command in the task's checkout with the allowed environment and the step's `env` lines.
 *  The step kind and the command policy both run through it, so they share one set of limits. */
async function runTaskCommand(
  core: CommandCore,
  taskId: string,
  config: CommandConfig,
  signal: AbortSignal,
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<CommandRun> {
  // Already rendered: `${inputs.x}` and `${steps.x.output}` were substituted before the handler was
  // called, so this is the command as it will run.
  const command = typeof config.command === 'string' ? config.command : ''
  if (!command.trim()) return { error: 'This step has no command.' }
  const task = await core.tasks.load(taskId)
  if (!task) return { error: 'The run has no task to run in.' }
  const project = task.projectId ? await core.projects.byId(task.projectId) : null
  const { cwd } = await core.tasks.resolveCwd(task, undefined)
  const extra = typeof config.env === 'string' ? parseEnvLines(config.env).env : {}
  const env = buildSessionEnv({
    taskId: task.id,
    cwd,
    task: project
      ? {
          projectId: project.id,
          projectName: project.name,
          github: project.github,
          branch: task.branch,
          title: task.title,
        }
      : null,
    env: extra,
  })
  const timeoutMs = typeof config.timeoutMs === 'number' ? config.timeoutMs : COMMAND_TIMEOUT_MS
  const result = await core.proc.runProcess({
    file: '/bin/sh',
    args: ['-c', command],
    cwd,
    env,
    timeoutMs,
    signal,
    ...(onOutput
      ? { onStdout: (text: string) => onOutput('stdout', text), onStderr: (text: string) => onOutput('stderr', text) }
      : {}),
  })
  return {
    result,
    timeoutMs,
    structured: { exitCode: result.code, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated },
  }
}

/** `terminal:command`: one shell command in the task's checkout, streamed and captured. */
export function commandStep(core: CommandCore): TerminalWorkflowStepKind {
  return {
    describe: {
      label: 'Run a command',
      description: 'Run one shell command in the task’s checkout and hand its output to the next step.',
      icon: 'terminal',
      fields: COMMAND_FIELDS,
      output: { description: 'The exit code, stdout and stderr, and whether the output was cut short.' },
    },
    validate: validateCommand,
    handler: async (ctx) => {
      const config = (ctx.def.with ?? {}) as CommandConfig
      const started = Date.now()
      const ran = await runTaskCommand(core, ctx.run.taskId, config, ctx.signal, (type, text) =>
        ctx.emit({ at: Date.now(), event: { type, text } }),
      )
      if ('error' in ran) return { status: 'failed', error: ran.error }
      const { result, timeoutMs, structured } = ran
      const data = { result: { durationMs: Date.now() - started }, structured }
      if (result.aborted) return { status: 'cancelled', error: 'Step cancelled.' }
      if (result.spawnError)
        return { status: 'failed', error: `The command could not start: ${result.spawnError}`, ...data }
      if (result.timedOut)
        return { status: 'failed', error: `The command did not finish within ${timeoutMs}ms.`, ...data }
      // A non-zero exit is a failure unless the step says otherwise. When it says otherwise it becomes
      // an answer, and a later `decide` can branch on the code.
      if (result.code !== 0 && config.allowFailure !== true) {
        const tail = result.stderr.trim().slice(-ERROR_TAIL) || result.stdout.trim().slice(-ERROR_TAIL)
        return {
          status: 'failed',
          error: `The command exited ${result.code ?? result.signal}${tail ? `: ${tail}` : '.'}`,
          ...data,
        }
      }
      return { status: 'done', ...data, handoff: result.stdout.trim() || undefined }
    },
  }
}

/** `EX_TEMPFAIL` from sysexits.h: the Unix code for "temporary failure, try again later". */
const EXIT_WAIT = 75

/** `terminal:command-check`: a `gate-policy` verdict from one command's exit code. 0 passes, 75 waits,
 *  and anything else fails. A command that cannot start or runs out of time is a failed poll, which
 *  the gate retries. */
export function commandCheckPolicy(core: CommandCore): TerminalWorkflowPolicy {
  return {
    describe: {
      label: 'Command exit code',
      description: 'Run a command in the task’s checkout. Exit 0 passes, 75 means not yet, anything else fails.',
      icon: 'terminal',
      fields: COMMAND_FIELDS.filter((field) => field.id !== 'allowFailure'),
    },
    validate: (settings) => commandProblems(settings as CommandConfig),
    evaluate: async (ctx) => {
      const ran = await runTaskCommand(core, ctx.taskId, ctx.with as CommandConfig, ctx.signal)
      if ('error' in ran) throw new Error(ran.error)
      const { result, timeoutMs, structured } = ran
      if (result.aborted) throw new Error('The check was cancelled.')
      if (result.spawnError) throw new Error(`The command could not start: ${result.spawnError}`)
      if (result.timedOut) throw new Error(`The command did not finish within ${timeoutMs}ms.`)
      const lastLine = result.stdout.trim().split('\n').at(-1)?.trim()
      const verdict = result.code === 0 ? 'pass' : result.code === EXIT_WAIT ? 'wait' : 'fail'
      return { verdict, ...(lastLine ? { detail: lastLine } : {}), value: structured }
    },
  }
}

/** `terminal:run-target`: start one of the project's declared run targets as a step of its own, so a
 *  later step can wait on it. */
export function runTargetStep(runtime: Pick<TerminalRunTargets, 'start' | 'status'>): TerminalWorkflowStepKind {
  return {
    describe: {
      label: 'Start a run target',
      description: 'Start one of the project’s declared run targets and report where it is listening.',
      icon: 'play',
      fields: RUN_TARGET_FIELDS,
      output: { description: 'The target id, its terminal session, and the URL it reported.' },
    },
    validate: validateRunTarget,
    handler: async (ctx) => {
      const config = (ctx.def.with ?? {}) as RunTargetConfig
      const targetId = typeof config.target === 'string' ? config.target : ''
      if (!targetId) return { status: 'failed', error: 'This step names no run target.' }
      const started = await runtime.start(ctx.run.taskId, targetId)
      if (!started.ok) return { status: 'failed', error: started.reason ?? `Could not start run target '${targetId}'.` }
      const sessionId = started.sessionId ?? null
      if (config.waitForUrl === false) return { status: 'done', structured: { targetId, sessionId, url: null } }
      ctx.emit({ at: Date.now(), event: { type: 'progress', text: `Waiting for ${targetId} to report a URL` } })
      const deadline = Date.now() + RUN_TARGET_URL_TIMEOUT_MS
      for (;;) {
        if (ctx.signal.aborted) return { status: 'cancelled', error: 'Step cancelled.' }
        const status = await runtime.status(ctx.run.taskId, targetId)
        if (status.url)
          return { status: 'done', structured: { targetId, sessionId, url: status.url }, handoff: status.url }
        if (!status.running)
          return {
            status: 'failed',
            error: `Run target '${targetId}' stopped with exit code ${status.exitCode ?? 'unknown'}.`,
          }
        if (Date.now() >= deadline) {
          return {
            status: 'failed',
            error: `Run target '${targetId}' did not report a URL within ${RUN_TARGET_URL_TIMEOUT_MS / 1000} seconds.`,
          }
        }
        await new Promise((resolve) => setTimeout(resolve, URL_POLL_MS))
      }
    },
  }
}
