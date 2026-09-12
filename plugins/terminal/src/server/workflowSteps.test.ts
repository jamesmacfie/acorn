import { describe, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'

type ProcSpec = Parameters<CoreServices['proc']['runProcess']>[0]
type ProcResult = Awaited<ReturnType<CoreServices['proc']['runProcess']>>
import { commandStep, COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS, parseEnvLines, runTargetStep } from './workflowSteps'

// The step context and definition shapes come from plugins/workflows, which this package cannot
// depend on (../contract/workflowSteps.ts says why). The mirrors there are what these fakes satisfy.
type StepDef = { name: string; kind: string; with: Record<string, unknown> }
type StepContext = Parameters<ReturnType<typeof commandStep>['handler']>[0]

// The process broker is faked, and deliberately: what it does with a real child — the environment
// allowlist, the group kill, the output cap, the chunk callbacks — is tested where it lives, in
// node-core's proc.test.ts. What this file is about is the decisions the step makes on top of a
// result: which exit codes are answers, which are failures, and what reaches the run pane.

const procResult = (over: Partial<ProcResult> = {}): ProcResult => ({
  code: 0,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  aborted: false,
  truncated: false,
  spawnError: null,
  ...over,
})

let lastSpec: ProcSpec | undefined
const runProcess = vi.fn(async (spec: ProcSpec) => {
  lastSpec = spec
  const scripted = SCRIPTS.get(spec.args?.[1] ?? '')
  scripted?.chunks?.forEach(([stream, text]) => (stream === 'out' ? spec.onStdout?.(text) : spec.onStderr?.(text)))
  return scripted?.result ?? procResult()
})

const SCRIPTS = new Map<string, { result?: ProcResult; chunks?: ['out' | 'err', string][] }>([
  ['two-chunks', { chunks: [['out', 'one\n'], ['err', 'oops\n'], ['out', 'two\n']], result: procResult({ stdout: 'one\ntwo\n', stderr: 'oops\n' }) }],
  ['fails', { result: procResult({ code: 3, stderr: 'nope\n' }) }],
  ['slow', { result: procResult({ code: null, timedOut: true }) }],
  ['interrupted', { result: procResult({ code: null, aborted: true }) }],
  ['missing', { result: procResult({ code: null, spawnError: 'ENOENT' }) }],
])

const core = {
  tasks: {
    load: async () => ({ id: 'task1', projectId: null, branch: null, title: 'A task' }),
    resolveCwd: async () => ({ cwd: '/tmp/checkout', isWorktree: false, created: false }),
  },
  projects: { byId: async () => null },
  identity: { active: () => 'james' },
  proc: { runProcess },
} as unknown as Pick<CoreServices, 'tasks' | 'projects' | 'proc' | 'identity'>

const validationContext = { label: "step 'shell'" }

const step = (withTable: Record<string, unknown>): StepDef => ({ name: 'shell', kind: 'terminal:command', with: withTable })

const run = async (withTable: Record<string, unknown>) => {
  const events: Record<string, unknown>[] = []
  const ctx = {
    run: { id: 'run1', taskId: 'task1' },
    def: step(withTable),
    signal: new AbortController().signal,
    emit: ({ event }: { event: Record<string, unknown> }) => void events.push(event),
  } as unknown as StepContext
  return { outcome: await commandStep(core).handler(ctx), events }
}

describe('the terminal:command step', () => {
  const validate = commandStep(core).validate

  it('names what is missing rather than saying the step is invalid', () => {
    expect(validate(step({}), validationContext)).toEqual(["step 'shell' has no command"])
    expect(validate(step({ command: 'true', timeoutMs: 10 }), validationContext))
      .toEqual([`step 'shell' timeout must be between 1000 and ${MAX_COMMAND_TIMEOUT_MS} milliseconds`])
    expect(validate(step({ command: 'true', timeoutMs: MAX_COMMAND_TIMEOUT_MS + 1 }), validationContext)).toHaveLength(1)
    expect(validate(step({ command: 'true', env: 'NOT AN ASSIGNMENT' }), validationContext))
      .toEqual(["step 'shell' env: 'NOT AN ASSIGNMENT' is not a KEY=value line"])
    expect(validate(step({ command: 'true', timeoutMs: 5_000, allowFailure: true, env: 'A=1' }), validationContext)).toEqual([])
  })

  it('reads KEY=value lines and skips blanks and comments', () => {
    expect(parseEnvLines('A=1\n\n# a note\nB = two ').env).toEqual({ A: '1', B: 'two' })
  })

  it('reports the exit code, stdout and stderr', async () => {
    const { outcome } = await run({ command: 'two-chunks' })
    expect(outcome.status).toBe('done')
    expect(outcome).toMatchObject({ structured: { exitCode: 0, stdout: 'one\ntwo\n', stderr: 'oops\n', truncated: false } })
  })

  it('runs in the task’s checkout, with the step’s environment and the default timeout', async () => {
    await run({ command: 'anything', env: 'GREETING=hello' })
    expect(lastSpec).toMatchObject({ file: '/bin/sh', args: ['-c', 'anything'], cwd: '/tmp/checkout', timeoutMs: COMMAND_TIMEOUT_MS })
    expect(lastSpec?.env).toMatchObject({ GREETING: 'hello', ACORN_TASK_ID: 'task1' })
  })

  it('fails on a non-zero exit unless the step allows it', async () => {
    const failed = await run({ command: 'fails' })
    expect(failed.outcome).toMatchObject({ status: 'failed' })
    expect((failed.outcome as { error: string }).error).toContain('exited 3')
    // An answer, not a failure: the exit code is in the output for a later `decide` to branch on.
    const allowed = await run({ command: 'fails', allowFailure: true })
    expect(allowed.outcome).toMatchObject({ status: 'done', structured: { exitCode: 3 } })
  })

  it('passes each chunk on through emit, in order and tagged by stream', async () => {
    const { events } = await run({ command: 'two-chunks' })
    expect(events).toEqual([
      { type: 'stdout', text: 'one\n' },
      { type: 'stderr', text: 'oops\n' },
      { type: 'stdout', text: 'two\n' },
    ])
  })

  it('tells a timeout, an abort and a missing binary apart', async () => {
    expect((await run({ command: 'slow' })).outcome).toMatchObject({ status: 'failed' })
    expect(((await run({ command: 'slow' })).outcome as { error: string }).error).toContain('did not finish')
    expect((await run({ command: 'interrupted' })).outcome).toMatchObject({ status: 'cancelled' })
    expect(((await run({ command: 'missing' })).outcome as { error: string }).error).toContain('could not start')
  })
})

describe('the terminal:run-target step', () => {
  const service = (over: Partial<{ start: unknown; status: unknown }> = {}) => ({
    start: async () => ({ ok: true, sessionId: 'sess1' }),
    status: async () => ({ running: true, url: 'http://localhost:5173' }),
    ...over,
  } as Parameters<typeof runTargetStep>[0])

  const context = (withTable: Record<string, unknown>) => ({
    run: { id: 'run1', taskId: 'task1' },
    step: { id: 'step1' },
    def: { name: 'dev', kind: 'terminal:run-target', with: withTable },
    renderedPrompt: '',
    tools: {},
    budget: {},
    signal: new AbortController().signal,
    inputs: {},
    upstream: [],
    emit: () => {},
  } as unknown as StepContext)

  it('refuses a step with no target', () => {
    expect(runTargetStep(service()).validate({ with: {} }, { label: "step 'dev'" }))
      .toEqual(["step 'dev' has no run target"])
  })

  it('reports the session and the URL the target came up on', async () => {
    const outcome = await runTargetStep(service()).handler(context({ target: 'dev' }))
    expect(outcome).toMatchObject({ status: 'done', structured: { targetId: 'dev', sessionId: 'sess1', url: 'http://localhost:5173' } })
  })

  it('does not wait when the step says not to', async () => {
    const never = service({ status: async () => ({ running: true }) })
    const outcome = await runTargetStep(never).handler(context({ target: 'dev', waitForUrl: false }))
    expect(outcome).toMatchObject({ status: 'done', structured: { url: null } })
  })

  it('fails when the target will not start', async () => {
    const refused = service({ start: async () => ({ ok: false, reason: 'No run target dev.' }) })
    expect(await runTargetStep(refused).handler(context({ target: 'dev' }))).toEqual({ status: 'failed', error: 'No run target dev.' })
  })

  it('fails when the target exits before it reports a URL', async () => {
    const died = service({ status: async () => ({ running: false, exitCode: 1 }) })
    const outcome = await runTargetStep(died).handler(context({ target: 'dev' }))
    expect((outcome as { error: string }).error).toContain('stopped with exit code 1')
  })
})
