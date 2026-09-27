import { workflowDataHandlers } from './data'
import { workflowIncrementalQuery } from '../processing/incremental'
import { type HeadlessResult, type PluginDatabase } from '@acorn/plugin-api/node'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import type { PolicyEvaluator, StepHandler, StepHandlerContext, StepHandlerOutcome, StepKindContribution, StepValidator, WorkflowStepDef, WorkflowStepRow } from '../../shared/workflowContracts'
import type { RunnerDeps, StepRunRequest } from '../runs/deps'

export const MAX_STEP_TURNS = 8

// The single source of truth for what ships built in. Registration below is keyed off these, and
// workflowFiles' default validation catalog reuses them.
export const BUILTIN_STEP_KINDS = ['agent', 'gate-human', 'gate-policy', 'ci-loop', 'decide', 'find-records', 'get-record-details', 'if'] as const
export const BUILTIN_POLICIES = ['checks-green'] as const

export const BUILTIN_STEP_VALIDATORS: Partial<Record<(typeof BUILTIN_STEP_KINDS)[number], StepValidator>> = {
  'gate-policy': (step, { label, policies }) => {
    if (!step.policy) return [`${label} has no policy`]
    return policies.has(step.policy) ? [] : [`${label} names unknown policy '${step.policy}'`]
  },
  decide: (step, { label, indexes, precedes }) => {
    const errors: string[] = []
    if (!step.branches || !Object.keys(step.branches).length) errors.push(`${label} has no branches`)
    for (const [verdict, target] of Object.entries(step.branches ?? {})) {
      // The edges, not the list position. A target has to wait on the decision, directly or through
      // the steps between them, or it would start beside it and the verdict would arrive too late to
      // matter. "Through the steps between them" is what a plain list of steps has always meant, so a
      // file written before the graph existed still passes.
      if (!indexes.has(target)) errors.push(`${label} branch '${verdict}' has invalid target '${target}'`)
      else if (!precedes(stepIdentity(step), target)) errors.push(`${label} branch '${verdict}' target '${target}' does not wait on ${label}`)
    }
    return errors
  },
}

type BuiltinServices = {
  db: PluginDatabase
  deps: RunnerDeps
  runHeadless(taskId: string, def: WorkflowStepDef, opts: StepRunRequest, ctx: StepHandlerContext): Promise<HeadlessResult>
  setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void>
  steps(runId: string): Promise<WorkflowStepRow[]>
  childSteps(parentStepId: string): Promise<WorkflowStepRow[]>
  registerActive(runId: string, stepId: string, controller: AbortController): void
  unregisterActive(runId: string, stepId: string): void
  changed(): void
  // `gate-policy` resolves its verdict source by the name the workflow file wrote, which may be a
  // built-in or another plugin's contribution. The runner owns that lookup, so the built-in asks it
  // rather than holding a registry of its own.
  policy(id: string): PolicyEvaluator | undefined
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
  return { status: 'failed', error: `${result.status}${result.stderrTail ? `: ${result.stderrTail.slice(0, 300)}` : ''}`, ...data }
}

// What ships in the box. Built-ins are not contributions: they are this plugin's own implementation of
// its own kinds, so they live in a plain object rather than going out through
// `ctx.extensionPoints.handle` and back in. That also keeps them addressable as bare words
// (`agent`, `join`) while a contributed kind is qualified (../../contract/extensions.ts).
export function buildBuiltinWorkflowContributions(services: BuiltinServices): {
  stepKinds: Map<string, StepKindContribution>
  policies: Map<string, PolicyEvaluator>
} {
  const policies = new Map<string, PolicyEvaluator>([
    ['checks-green', (taskId: string) => services.deps.evaluatePolicy(taskId, 'checks-green')],
  ])
  const stepKinds: Record<(typeof BUILTIN_STEP_KINDS)[number], StepHandler> = {
    ...workflowDataHandlers({ access: services.deps.dataAccess, setStep: services.setStep,
      incremental: (runId, stepId, query) => workflowIncrementalQuery(services.db, runId, stepId, query) }),
    agent: runAgent,
    'gate-human': async (ctx) =>
      ctx.run.posture === 'autonomous' ? { status: 'done', result: { approved: 'autonomous' } } : { status: 'waiting-gate' },
    'gate-policy': runPolicy,
    'ci-loop': runCiLoop,
    decide: runDecision,
  }
  const kinds = new Map<string, StepKindContribution>(
    BUILTIN_STEP_KINDS.map((kind) => [kind, {
      handler: stepKinds[kind],
      validate: BUILTIN_STEP_VALIDATORS[kind],
      // The same `describe` a contributed kind carries, from the table in ../../shared/stepFields.ts.
      // The editor draws a built-in and a contribution the same way.
      describe: BUILTIN_STEP_DESCRIPTIONS[kind],
    }]),
  )
  // Returned before the handlers below are written, which is fine and deliberate: they are function
  // declarations, so they are hoisted and already bound by the time a step dispatches into one.
  return { stepKinds: kinds, policies }

  // What any step that runs an agent actually sends: its own prompt, then every incoming edge's
  // output under a heading, then the task context block that carries the handoff trail
  // (docs/workflows.md § What an agent step sees). Shared by all four agent-running kinds, because
  // the editor offers the Upstream output control on all four and each one used to answer it
  // differently: until 2026-09-09 only `agent` read `upstream` at all, so a `decide` step set to
  // Append silently saw none of the analysis it was asked to decide on.
  //
  // 'template' means the prompt places `${steps.x.output}` itself and 'none' means it stands alone.
  // The context block rides along in every mode, because that is separate from the graph's edges.
  async function agentPrompt(ctx: StepHandlerContext, base: string): Promise<string> {
    const prompt = (ctx.def.inputs ?? 'append') === 'append' && ctx.upstream.length
      ? [base, ...ctx.upstream.map((step) => `## Output of ${step.name}\n\n${step.output}`)].filter(Boolean).join('\n\n')
      : base
    const context = await services.deps.assembleContext(ctx.run.taskId, ctx.run.id)
    return context ? `${prompt}\n\n${context}` : prompt
  }

  async function runAgent(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    let prompt = ctx.renderedPrompt
    if (ctx.def.requiresRun) {
      if (!services.deps.startRunTarget) return { status: 'failed', error: `Run target '${ctx.def.requiresRun}' is unavailable.` }
      const target = await services.deps.startRunTarget(ctx.run.taskId, ctx.def.requiresRun)
      if (!target.ok) return { status: 'failed', error: `Could not start run target '${ctx.def.requiresRun}'.` }
      if (target.url) prompt = `${prompt}\n\nThe app is running at: ${target.url}`
    }
    const inputs = await agentPrompt(ctx, prompt)
    const outcome = headlessOutcome(
      await services.runHeadless(
        ctx.run.taskId,
        ctx.def,
        { prompt: inputs, model: ctx.def.model, schema: ctx.def.schema, signal: ctx.signal, tools: ctx.tools },
        ctx,
      ),
    )
    if (outcome.status !== 'done') return outcome
    const handoff = outcome.structured !== undefined ? JSON.stringify(outcome.structured, null, 2) : ((outcome.result as { result?: string }).result ?? '')
    return { ...outcome, inputs: { prompt: inputs, tools: ctx.tools }, ...(handoff ? { handoff } : {}) }
  }

  async function runDecision(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const schema = ctx.def.schema ?? {
      type: 'object',
      properties: { verdict: { type: 'string' } },
      required: ['verdict'],
      additionalProperties: true,
    }
    const prompt = await agentPrompt(ctx, ctx.renderedPrompt)
    const result = await services.runHeadless(
      ctx.run.taskId,
      ctx.def,
      { prompt, model: ctx.def.model, schema, mode: 'ai', signal: ctx.signal, tools: { allow: [] } },
      ctx,
    )
    const outcome = { ...headlessOutcome(result), inputs: { prompt, tools: { allow: [] } } }
    if (outcome.status === 'done' && (!outcome.structured || typeof (outcome.structured as { verdict?: unknown }).verdict !== 'string')) {
      return { ...outcome, status: 'failed', error: `Decision '${ctx.def.name}' returned no scalar verdict.` }
    }
    return outcome
  }

  async function runPolicy(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const policy = ctx.def.policy ? services.policy(ctx.def.policy) : undefined
    if (!policy) return { status: 'failed', error: `Unknown policy '${ctx.def.policy ?? ''}'.` }
    const verdict = await policy(ctx.run.taskId)
    return verdict.pass ? { status: 'done', result: verdict } : { status: 'failed', error: verdict.detail ?? `Policy '${ctx.def.policy}' failed.` }
  }

  async function runCiLoop(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const max = Math.min(ctx.def.maxIterations ?? 3, ctx.budget.maxTurns ?? MAX_STEP_TURNS, MAX_STEP_TURNS)
    let iteration = ctx.step.iteration
    let sessionId = ctx.step.sessionId ?? undefined
    let agentSessionId = ctx.step.agentSessionId ?? undefined
    const fallback = ctx.renderedPrompt || 'Fix the failing CI checks, then commit and push.'
    // Only the turn that opens the session pays for the upstream output and the context block. A
    // resumed turn already has both in its history.
    const opening = sessionId ? fallback : await agentPrompt(ctx, fallback)
    for (;;) {
      if (ctx.signal.aborted) return { status: 'cancelled' }
      const failing = await services.deps.failingChecks(ctx.run.taskId)
      if (failing === '') {
        return { status: 'done', result: { green: true, iterations: iteration }, sessionId, agentSessionId }
      }
      if (failing === null) return { status: 'failed', error: 'No checks to poll (no PR?).' }
      if (iteration >= max) return { status: 'safety-rail', error: `Safety rail: ${max} fix iterations exhausted.` }
      iteration += 1
      await services.setStep(ctx.step.id, { iteration })
      const result = await services.runHeadless(
        ctx.run.taskId,
        ctx.def,
        {
          prompt: `${sessionId ? fallback : opening}\n\nFailing checks:\n${failing}`,
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
import { stepIdentity } from '../../shared/workflowIdentity'
