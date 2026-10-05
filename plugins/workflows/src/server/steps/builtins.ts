import { workflowDataHandlers } from './data'
import { workflowIncrementalQuery } from '../processing/incremental'
import { BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from '../definitions/builtinDefinitions'
import { type HeadlessResult, type PluginDatabase } from '@acorn/plugin-api/node'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import type { GateFormOutput, GateFormProposal } from '../../shared/gateForm'
import { resolveGateFormProposal } from '../validation/bindings'
import type { PolicyEvaluator, StepHandler, StepHandlerContext, StepHandlerOutcome, StepKindContribution, WorkflowStepDef, WorkflowStepRow } from '../../shared/workflowContracts'
import { inlinePrompt, type RunnerDeps, type StepContextItem, type StepRunRequest } from '../runs/deps'

export const MAX_STEP_TURNS = 8

export { BUILTIN_POLICIES, BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from '../definitions/builtinDefinitions'

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
    'gate-human': runHumanGate,
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
  // output, then the task context block that carries the handoff trail (docs/workflows/agent-steps.md § What an
  // agent step sees). The outputs and the task context travel as context items, not as prompt text,
  // so the model reads them as information and the transcript shows only the prompt. Shared by all
  // four agent-running kinds, because the editor offers the Upstream output control on all four and
  // each one used to answer it differently: until 2026-09-09 only `agent` read `upstream` at all, so
  // a `decide` step set to Append silently saw none of the analysis it was asked to decide on.
  //
  // 'template' means the prompt places `${steps.x.output}` itself and 'none' means it stands alone.
  // The context block rides along in every mode, because that is separate from the graph's edges.
  async function agentPrompt(ctx: StepHandlerContext, base: string): Promise<{ prompt: string; context: StepContextItem[] }> {
    const upstream = (ctx.def.inputs ?? 'append') === 'append'
      ? ctx.upstream.map((step) => ({ label: `Output of ${step.name}`, source: 'workflow.upstream', content: step.output }))
      : []
    const task = await services.deps.assembleContext(ctx.run.taskId, ctx.run.id)
    return {
      prompt: base,
      context: [...upstream, ...(task ? [{ label: 'Task context', source: 'workflow.task-context', content: task }] : [])],
    }
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
        { ...inputs, model: ctx.def.model, schema: ctx.def.schema, signal: ctx.signal, tools: ctx.tools },
        ctx,
      ),
    )
    if (outcome.status !== 'done') return outcome
    const handoff = outcome.structured !== undefined ? JSON.stringify(outcome.structured, null, 2) : ((outcome.result as { result?: string }).result ?? '')
    return { ...outcome, inputs: { prompt: inlinePrompt(inputs.prompt, inputs.context), tools: ctx.tools }, ...(handoff ? { handoff } : {}) }
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
      return { status: 'failed', error: error instanceof Error ? error.message : 'The form proposal could not be resolved.' }
    }
    const inputs: GateFormProposal = { form: { values } }
    if (!autonomous) return { status: 'waiting-gate', inputs }
    const missing = form.fields.filter((field) => field.required && values[field.name] === undefined).map((field) => field.name)
    if (missing.length) {
      return { status: 'failed', error: `The run is autonomous, so nobody was asked to fill the required form fields: ${missing.join(', ')}.` }
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
    const outcome = { ...headlessOutcome(result), inputs: { prompt: inlinePrompt(inputs.prompt, inputs.context), tools: { allow: [] } } }
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
    const opening = sessionId ? { prompt: fallback, context: [] } : await agentPrompt(ctx, fallback)
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
          prompt: `${sessionId ? fallback : opening.prompt}\n\nFailing checks:\n${failing}`,
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
