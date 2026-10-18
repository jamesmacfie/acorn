import { workflowDataHandlers } from './data'
import { workflowIncrementalQuery } from '../processing/incremental'
import { BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from '../definitions/builtinDefinitions'
import { type HeadlessResult, type PluginDatabase } from '@acorn/plugin-api/node'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import type { GateFormOutput, GateFormProposal } from '../../shared/gateForm'
import { resolveGateFormProposal } from '../validation/bindings'
import { setTimeout as delay } from 'node:timers/promises'
import { taskScriptAcceptable, taskScriptSettled } from '@acorn/protocol/taskScripts.ts'
import { CODE_HOST_POLICY, type CiSettledValue } from '../../contract/extensions'
import { DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS, readPolicyWait } from '../../shared/policyWait'
import { waitForPolicy, type PolicyWaitOptions } from './policyWait'
import { intersectToolCeilings } from './tools'
import type {
  PolicyContext,
  PolicyContribution,
  PolicyVerdict,
  StepHandler,
  StepHandlerContext,
  StepHandlerOutcome,
  StepKindContribution,
  WorkflowStepDef,
  WorkflowStepRow,
} from '../../shared/workflowContracts'
import { inlinePrompt, type RunnerDeps, type StepContextItem, type StepRunRequest } from '../runs/deps'

const MAX_STEP_TURNS = 8
const DEFAULT_CHECKS_TIMEOUT_MS = 1_800_000
/** Each agent poll takes an agent slot and spends the run's budget, so it may not ask often. */
const AGENT_POLICY_MIN_INTERVAL_MS = 300_000
const AGENT_VERDICT_SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['pass', 'wait', 'fail'] }, reason: { type: 'string' } },
  required: ['verdict', 'reason'],
  additionalProperties: false,
}
const AGENT_VERDICT_INSTRUCTIONS =
  'Answer with a verdict. Say pass when the condition holds, wait when it does not hold yet but still could, and fail when it never will. Give one line on what you saw as the reason.'

/** What each code host policy reads, for the message when a task has nobody to ask. */
const CODE_HOST_READS = { [CODE_HOST_POLICY.ciSettled]: 'checks', [CODE_HOST_POLICY.reviewReceived]: 'reviews' }

const sleepUnlessAborted = (ms: number, signal: AbortSignal): Promise<void> =>
  delay(ms, undefined, { signal }).catch(() => undefined)

/** A policy as a gate runs it. A built-in also gets the step it is polling for, because the agent
 *  policy runs its turn against that step's budget. A contribution never sees the step. */
export type RunnablePolicy = Omit<PolicyContribution, 'evaluate'> & {
  evaluate(ctx: PolicyContext, step: StepHandlerContext): Promise<PolicyVerdict>
}

export { BUILTIN_POLICIES, BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from '../definitions/builtinDefinitions'

type BuiltinServices = {
  db: PluginDatabase
  deps: RunnerDeps
  runHeadless(
    taskId: string,
    def: WorkflowStepDef,
    opts: StepRunRequest,
    ctx: StepHandlerContext,
  ): Promise<HeadlessResult>
  setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void>
  steps(runId: string): Promise<WorkflowStepRow[]>
  childSteps(parentStepId: string): Promise<WorkflowStepRow[]>
  registerActive(runId: string, stepId: string, controller: AbortController): void
  unregisterActive(runId: string, stepId: string): void
  changed(): void
  // `gate-policy` resolves its verdict source by the name the workflow file wrote, which may be a
  // built-in or another plugin's contribution. The runner owns that lookup, so the built-in asks it
  // rather than holding a registry of its own.
  policy(id: string): RunnablePolicy | undefined
}

function headlessOutcome(result: HeadlessResult): StepHandlerOutcome {
  const data = {
    result: {
      status: result.status,
      exitCode: result.exitCode,
      result: result.capture.result,
      stderrTail: result.stderrTail,
      events: result.capture.events.slice(-100),
    },
    structured: result.capture.structuredOutput ?? undefined,
    sessionId: result.capture.sessionId,
    agentSessionId: result.agentSessionId,
    costUsd: result.capture.costUsd,
    usage: result.capture.usage,
    events: result.capture.events,
  }
  if (result.status === 'ok') return { status: 'done', ...data }
  if (result.status === 'cancelled') return { status: 'cancelled', error: 'Step cancelled.' }
  return {
    status: 'failed',
    error: `${result.status}${result.stderrTail ? `: ${result.stderrTail.slice(0, 300)}` : ''}`,
    ...data,
  }
}

// What ships in the box. Built-ins are not contributions: they are this plugin's own implementation of
// its own kinds, so they live in a plain object rather than going out through
// `ctx.extensionPoints.handle` and back in. That also keeps them addressable as bare words
// (`agent`, `join`) while a contributed kind is qualified (../../contract/extensions.ts).
export function buildBuiltinWorkflowContributions(services: BuiltinServices): {
  stepKinds: Map<string, StepKindContribution>
  policies: Map<string, RunnablePolicy>
} {
  const policies = new Map<string, RunnablePolicy>([
    [
      'checks-green',
      {
        describe: {
          label: 'Checks passed',
          description:
            "Whether every check on the pull request passed. Asks the code host's ci-settled policy, such as github:ci-settled.",
          icon: 'shield-check',
          fields: [],
        },
        evaluate: (ctx, step) => askCodeHost(CODE_HOST_POLICY.ciSettled, ctx, step),
      },
    ],
    [
      'review-received',
      {
        describe: {
          label: 'Review received',
          description:
            "Whether someone reviewed the pull request after the wait started. Asks the code host's review-received policy, such as github:review-received.",
          icon: 'messages-square',
          fields: [],
        },
        evaluate: (ctx, step) => askCodeHost(CODE_HOST_POLICY.reviewReceived, ctx, step),
      },
    ],
    [
      'setup-settled',
      {
        describe: {
          label: 'Setup finished',
          description:
            "Whether the task's setup script finished. Passes when it succeeded or the task has none, and fails when it failed or stopped.",
          icon: 'wrench',
          fields: [],
        },
        evaluate: setupSettled,
      },
    ],
    [
      'agent',
      {
        describe: {
          label: 'Ask an agent',
          description: 'Ask an agent with read-only tools whether a condition holds yet.',
          icon: 'bot',
          minIntervalMs: AGENT_POLICY_MIN_INTERVAL_MS,
          fields: [{ id: 'prompt', label: 'Condition', type: 'prompt', required: true }],
        },
        validate: (settings) =>
          typeof settings.prompt === 'string' && settings.prompt.trim() ? [] : ['needs a condition to ask about'],
        evaluate: askAgent,
      },
    ],
  ])
  const stepKinds: Record<(typeof BUILTIN_STEP_KINDS)[number], StepHandler> = {
    ...workflowDataHandlers({
      access: services.deps.dataAccess,
      setStep: services.setStep,
      incremental: (runId, stepId, query) => workflowIncrementalQuery(services.db, runId, stepId, query),
    }),
    agent: runAgent,
    'gate-human': runHumanGate,
    'gate-policy': runPolicy,
    'ci-loop': runCiLoop,
    decide: runDecision,
  }
  const kinds = new Map<string, StepKindContribution>(
    BUILTIN_STEP_KINDS.map((kind) => [
      kind,
      {
        handler: stepKinds[kind],
        validate: BUILTIN_STEP_VALIDATORS[kind],
        // The same `describe` a contributed kind carries, so the editor draws a built-in and a
        // contribution the same way.
        describe: BUILTIN_STEP_DESCRIPTIONS[kind],
      },
    ]),
  )
  // Returned before the handlers below are written, which is fine and deliberate: they are function
  // declarations, so they are hoisted and already bound by the time a step dispatches into one.
  return { stepKinds: kinds, policies }

  // What any step that runs an agent actually sends: its own prompt, then every incoming edge's
  // output, then the task context block that carries the handoff trail
  // (docs/workflows/agent-steps.md § What an agent step sees). The outputs and the task context travel
  // as context items, not as prompt text, so the model reads them as information and the transcript
  // shows only the prompt. Every agent-running kind shares it, because the editor offers the Upstream
  // output control on all of them.
  //
  // 'template' means the prompt places `${steps.x.output}` itself and 'none' means it stands alone.
  // The context block rides along in every mode, because that is separate from the graph's edges.
  async function agentPrompt(
    ctx: StepHandlerContext,
    base: string,
  ): Promise<{ prompt: string; context: StepContextItem[] }> {
    const upstream =
      (ctx.def.inputs ?? 'append') === 'append'
        ? ctx.upstream.map((step) => ({
            label: `Output of ${step.name}`,
            source: 'workflow.upstream',
            content: step.output,
          }))
        : []
    const task = await services.deps.assembleContext(ctx.run.taskId, ctx.run.id)
    return {
      prompt: base,
      context: [
        ...upstream,
        ...(ctx.run.trigger === 'agent-map'
          ? [{ label: 'Current item', source: 'workflow.item', content: JSON.stringify(ctx.inputs.item) }]
          : []),
        ...(task ? [{ label: 'Task context', source: 'workflow.task-context', content: task }] : []),
      ],
    }
  }

  async function runAgent(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    let prompt = ctx.renderedPrompt
    if (ctx.def.requiresRun) {
      if (!services.deps.startRunTarget)
        return { status: 'failed', error: `Run target '${ctx.def.requiresRun}' is unavailable.` }
      const target = await services.deps.startRunTarget(ctx.run.taskId, ctx.def.requiresRun)
      if (!target.ok) return { status: 'failed', error: `Could not start run target '${ctx.def.requiresRun}'.` }
      if (target.url) prompt = `${prompt}\n\nThe app is running at: ${target.url}`
    }
    const inputs = await agentPrompt(ctx, prompt)
    const outcome = headlessOutcome(
      await services.runHeadless(
        ctx.run.taskId,
        ctx.def,
        {
          ...inputs,
          model: ctx.def.model,
          schema: ctx.def.schema,
          signal: ctx.signal,
          tools: ctx.tools,
          ...(ctx.renderedGoal !== undefined ? { goal: ctx.renderedGoal } : {}),
        },
        ctx,
      ),
    )
    if (outcome.status !== 'done') return outcome
    const handoff =
      outcome.structured !== undefined
        ? JSON.stringify(outcome.structured, null, 2)
        : ((outcome.result as { result?: string }).result ?? '')
    return {
      ...outcome,
      inputs: { prompt: inlinePrompt(inputs.prompt, inputs.context), tools: ctx.tools },
      ...(handoff ? { handoff } : {}),
    }
  }

  // A plain gate waits, or passes straight through under an autonomous posture. A gate with a form
  // resolves its proposal first and freezes it into the step, so the reviewer edits against values
  // that cannot move underneath them.
  async function runHumanGate(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const autonomous = ctx.run.posture === 'autonomous'
    const form = ctx.def.form
    if (!form) return autonomous ? { status: 'done', result: { approved: 'autonomous' } } : { status: 'waiting-gate' }
    let values: GateFormProposal['form']['values']
    try {
      values = resolveGateFormProposal(form, ctx.inputs, await services.steps(ctx.run.id), ctx.predecessorValues)
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'The form proposal could not be resolved.',
      }
    }
    const inputs: GateFormProposal = { form: { values } }
    if (!autonomous) return { status: 'waiting-gate', inputs }
    const missing = form.fields
      .filter((field) => field.required && values[field.name] === undefined)
      .map((field) => field.name)
    if (missing.length) {
      return {
        status: 'failed',
        error: `The run is autonomous, so nobody was asked to fill the required form fields: ${missing.join(', ')}.`,
      }
    }
    const output: GateFormOutput = { approved: 'autonomous', values, edited: [] }
    return { status: 'done', result: { approved: 'autonomous' }, structured: output, inputs }
  }

  async function runDecision(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const schema = ctx.def.schema ?? {
      type: 'object',
      properties: { verdict: { type: 'string' } },
      required: ['verdict'],
      additionalProperties: true,
    }
    const inputs = await agentPrompt(ctx, ctx.renderedPrompt)
    const result = await services.runHeadless(
      ctx.run.taskId,
      ctx.def,
      { ...inputs, model: ctx.def.model, schema, mode: 'ai', signal: ctx.signal, tools: { allow: [] } },
      ctx,
    )
    const outcome = {
      ...headlessOutcome(result),
      inputs: { prompt: inlinePrompt(inputs.prompt, inputs.context), tools: { allow: [] } },
    }
    if (
      outcome.status === 'done' &&
      (!outcome.structured || typeof (outcome.structured as { verdict?: unknown }).verdict !== 'string')
    ) {
      return { ...outcome, status: 'failed', error: `Decision '${ctx.def.name}' returned no scalar verdict.` }
    }
    return outcome
  }

  /** The step-row plumbing every wait needs: where it saves, how it takes the checkout, and what it
   *  tells the run pane. */
  function waitServices(
    ctx: StepHandlerContext,
  ): Pick<PolicyWaitOptions, 'taskId' | 'signal' | 'save' | 'admit' | 'progress' | 'sleep'> {
    const taskId = ctx.run.taskId
    return {
      taskId,
      signal: ctx.signal,
      // Merged into what execution already wrote this attempt, so the prompt and ceiling stay readable.
      save: async (record) => {
        const row = (await services.steps(ctx.run.id)).find((candidate) => candidate.id === ctx.step.id)
        const inputs = row?.inputsJson ? (JSON.parse(row.inputsJson) as Record<string, unknown>) : {}
        if (record) inputs.policyWait = record
        else delete inputs.policyWait
        await services.setStep(ctx.step.id, { inputsJson: JSON.stringify(inputs) })
      },
      admit: (write) => (services.deps.admitWork ? services.deps.admitWork(taskId, write) : write()),
      progress: (text) => ctx.emit({ at: Date.now(), event: { type: 'progress', text } }),
      sleep: services.deps.sleep ?? sleepUnlessAborted,
    }
  }

  /** The policy `<host>:<entryId>` from the code host of the task's pull request, or why there is none.
   *  Resolved per call, because the task's pull request can move and the code host may init after this
   *  plugin or be turned off. */
  async function codeHostPolicy(
    taskId: string,
    entryId: keyof typeof CODE_HOST_READS,
  ): Promise<{ policy: RunnablePolicy } | { error: string }> {
    const reads = CODE_HOST_READS[entryId]
    const host = await services.deps.taskCodeHost?.(taskId)
    if (!host) return { error: `This task has no pull request, so there are no ${reads} to read.` }
    const policy = services.policy(`${host}:${entryId}`)
    if (!policy)
      return { error: `The ${host} plugin is off or has no ${entryId} policy, so there are no ${reads} to read.` }
    return { policy }
  }

  // Nobody to ask fails closed: no checks or reviews to read must not pass a gate.
  async function askCodeHost(
    entryId: keyof typeof CODE_HOST_READS,
    policyCtx: PolicyContext,
    ctx: StepHandlerContext,
  ): Promise<PolicyVerdict> {
    const found = await codeHostPolicy(policyCtx.taskId, entryId)
    return 'error' in found ? { verdict: 'fail', detail: found.error } : found.policy.evaluate(policyCtx, ctx)
  }

  async function runPolicy(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const id = ctx.def.policy ?? ''
    const policy = services.policy(id)
    if (!policy) return { status: 'failed', error: `Unknown policy '${id}'.` }
    // A timeout is what makes a gate poll. Without one it asks once, as every gate did before polling.
    const timing =
      ctx.def.timeoutMs === undefined
        ? undefined
        : {
            intervalMs: ctx.def.intervalMs ?? Math.max(DEFAULT_POLL_INTERVAL_MS, policy.describe.minIntervalMs ?? 0),
            timeoutMs: ctx.def.timeoutMs,
          }
    const result = await waitForPolicy({
      ...waitServices(ctx),
      evaluate: (policyCtx) => policy.evaluate(policyCtx, ctx),
      settings: ctx.def.with ?? {},
      timing,
      saved: timing ? readPolicyWait(ctx.step.inputsJson) : undefined,
    })
    if ('cancelled' in result) return { status: 'cancelled', error: 'Step cancelled.' }
    if ('error' in result) return { status: 'failed', error: `Policy '${id}' could not be checked: ${result.error}` }
    // With branches, every answer that has a branch finishes the step and the runner takes it.
    if (result.verdict === 'pass' || ctx.def.branches?.[result.verdict])
      return { status: 'done', result, structured: result }
    const reason = result.verdict === 'timed-out' ? 'did not pass before its timeout' : 'failed'
    return {
      status: 'failed',
      error: `Policy '${id}' ${reason}${result.detail ? `: ${result.detail}` : '.'}`,
      result,
      structured: result,
    }
  }

  // Reads core's record of the setup attempt, so a poll costs nothing. A setup that hasn't started
  // yet waits, because a task's worktree, and so its setup, can start after the run does.
  async function setupSettled({ taskId }: PolicyContext): Promise<PolicyVerdict> {
    const setup = await services.deps.taskSetup?.(taskId)
    if (!setup) return { verdict: 'fail', detail: 'Setup status is unavailable on this Node.' }
    if (taskScriptAcceptable(setup))
      return {
        verdict: 'pass',
        detail: setup.state === 'succeeded' ? 'Setup finished.' : 'This task has no setup to run.',
      }
    if (setup.state === 'unknown')
      return {
        verdict: 'fail',
        detail: "This task's setup history isn't recorded, so it can't tell whether setup ran.",
      }
    if (taskScriptSettled(setup.state))
      return {
        verdict: 'fail',
        detail:
          setup.exitCode !== null
            ? `Setup exited with code ${setup.exitCode}.`
            : `Setup ${setup.state}: ${setup.reason.replaceAll('_', ' ')}.`,
      }
    return {
      verdict: 'wait',
      detail: setup.state === 'not_started' ? "Setup hasn't started." : `Setup is ${setup.state}.`,
    }
  }

  // A fresh one-shot turn per poll, as `decide` runs, with read-only tools so it can notice a change,
  // and its last answer as context so it can say what changed.
  async function askAgent(policyCtx: PolicyContext, ctx: StepHandlerContext): Promise<PolicyVerdict> {
    const condition = typeof policyCtx.with.prompt === 'string' ? policyCtx.with.prompt : ''
    const inputs = await agentPrompt(ctx, `${condition}\n\n${AGENT_VERDICT_INSTRUCTIONS}`)
    const previous = policyCtx.previous?.detail
    const tools = intersectToolCeilings(ctx.tools, { maxRisk: 'read' })
    const result = await services.runHeadless(
      ctx.run.taskId,
      ctx.def,
      {
        prompt: inputs.prompt,
        context: [
          ...inputs.context,
          ...(previous ? [{ label: 'Your last answer', source: 'workflow.policy-previous', content: previous }] : []),
        ],
        model: ctx.def.model,
        schema: AGENT_VERDICT_SCHEMA,
        mode: 'ai',
        signal: policyCtx.signal,
        tools,
      },
      // No session to resume: each poll is a turn of its own.
      { ...ctx, step: { ...ctx.step, agentSessionId: null } },
    )
    // A failed turn is a failed poll, which the wait retries at the next interval.
    if (result.status !== 'ok')
      throw new Error(
        `The agent turn ended ${result.status}${result.stderrTail ? `: ${result.stderrTail.slice(0, 300)}` : '.'}`,
      )
    const answer = (result.capture.structuredOutput ?? {}) as { verdict?: unknown; reason?: unknown }
    return {
      verdict: answer.verdict as PolicyVerdict['verdict'],
      ...(typeof answer.reason === 'string' ? { detail: answer.reason } : {}),
    }
  }

  async function runCiLoop(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const max = Math.min(ctx.def.maxIterations ?? 3, ctx.budget.maxTurns ?? MAX_STEP_TURNS, MAX_STEP_TURNS)
    const found = await codeHostPolicy(ctx.run.taskId, CODE_HOST_POLICY.ciSettled)
    if ('error' in found) return { status: 'failed', error: found.error }
    const ci = found.policy
    let iteration = ctx.step.iteration
    let sessionId = ctx.step.sessionId ?? undefined
    let agentSessionId = ctx.step.agentSessionId ?? undefined
    let saved = readPolicyWait(ctx.step.inputsJson)
    const checksTimeoutMs = ctx.def.checksTimeoutMs ?? DEFAULT_CHECKS_TIMEOUT_MS
    const fallback = ctx.renderedPrompt || 'Fix the failing CI checks, then commit and push.'
    // Only the turn that opens the session pays for the upstream output and the context block. A
    // resumed turn already has both in its history.
    const opening = sessionId ? { prompt: fallback, context: [] } : await agentPrompt(ctx, fallback)
    for (;;) {
      if (ctx.signal.aborted) return { status: 'cancelled' }
      const checks = await waitForPolicy({
        ...waitServices(ctx),
        evaluate: (policyCtx) => ci.evaluate(policyCtx, ctx),
        // After a fix turn pushes, the new commit has no checks for a moment. That is not "no checks".
        settings: iteration > 0 ? { missing: 'wait' } : {},
        timing: {
          intervalMs: Math.max(MIN_POLL_INTERVAL_MS, ci.describe.minIntervalMs ?? 0),
          timeoutMs: checksTimeoutMs,
        },
        saved,
      })
      saved = undefined
      if ('cancelled' in checks) return { status: 'cancelled' }
      if ('error' in checks) return { status: 'failed', error: `The checks could not be read: ${checks.error}` }
      if (checks.verdict === 'pass') {
        return { status: 'done', result: { green: true, iterations: iteration }, sessionId, agentSessionId }
      }
      if (checks.verdict === 'timed-out')
        return { status: 'failed', error: `The checks did not finish within ${checksTimeoutMs} ms.` }
      const failing = (checks.value as CiSettledValue | undefined)?.failing ?? []
      if (!failing.length) return { status: 'failed', error: checks.detail ?? 'No checks to poll (no PR?).' }
      if (iteration >= max) return { status: 'safety-rail', error: `Safety rail: ${max} fix iterations exhausted.` }
      iteration += 1
      await services.setStep(ctx.step.id, { iteration })
      const list = failing.map((check) => `- ${check.name}: ${check.status}${check.url ? ` (${check.url})` : ''}`)
      const result = await services.runHeadless(
        ctx.run.taskId,
        ctx.def,
        {
          prompt: `${sessionId ? fallback : opening.prompt}\n\nFailing checks:\n${list.join('\n')}`,
          context: sessionId ? undefined : opening.context,
          model: ctx.def.model,
          schema: ctx.def.schema,
          resumeSessionId: sessionId,
          managedSessionId: agentSessionId,
          signal: ctx.signal,
          tools: ctx.tools,
        },
        ctx,
      )
      sessionId = result.capture.sessionId ?? sessionId
      agentSessionId = result.agentSessionId ?? agentSessionId
      if (result.status !== 'ok') return headlessOutcome(result)
    }
  }
}
