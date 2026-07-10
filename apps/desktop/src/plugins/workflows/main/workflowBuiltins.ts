import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../../core/server/db'
import { schema } from '../../../core/server/db'
import type { HeadlessResult } from '../../../core/main/headless'
import { DEFAULT_PROFILE_ID } from '../../../core/main/agentProfiles'
import type { StepHandler, StepHandlerContext, StepHandlerOutcome, WorkflowStepDef, WorkflowStepRow } from './workflowContracts'
import type { WorkflowContributionRegistry } from './workflowRegistry'
import type { RunnerDeps, RunStepOptions } from './workflowRunner'
import { intersectToolCeilings } from './workflowTools'
import { renderWorkflowPrompt } from './workflowValidation'

export const MAX_STEP_TURNS = 8
export const MAX_FAN_OUT_TASKS = 12

// The single source of truth for what ships built in — registration below is keyed off these, and
// workflowFiles' default validation catalog reuses them.
export const BUILTIN_STEP_KINDS = ['agent', 'gate-human', 'gate-policy', 'ci-loop', 'fan-out', 'join', 'decide'] as const
export const BUILTIN_POLICIES = ['checks-green'] as const

type BuiltinServices = {
  db: AppDatabase
  deps: RunnerDeps
  runHeadless(taskId: string, def: WorkflowStepDef, opts: RunStepOptions, ctx: StepHandlerContext): Promise<HeadlessResult>
  setStep(stepId: string, patch: Partial<WorkflowStepRow>): Promise<void>
  steps(runId: string): Promise<WorkflowStepRow[]>
  childSteps(parentStepId: string): Promise<WorkflowStepRow[]>
  registerActive(runId: string, stepId: string, controller: AbortController): void
  unregisterActive(runId: string, stepId: string): void
  changed(): void
}

const now = () => Date.now()

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
    costUsd: result.capture.costUsd,
    events: result.capture.events,
  }
  if (result.status === 'ok') return { status: 'done', ...data }
  if (result.status === 'cancelled') return { status: 'cancelled', error: 'Step cancelled.' }
  return { status: 'failed', error: `${result.status}${result.stderrTail ? `: ${result.stderrTail.slice(0, 300)}` : ''}`, ...data }
}

export function registerBuiltinWorkflowContributions(registry: WorkflowContributionRegistry, services: BuiltinServices): void {
  registry.registerPolicy('checks-green', (taskId) => services.deps.evaluatePolicy(taskId, 'checks-green'))
  const stepKinds: Record<(typeof BUILTIN_STEP_KINDS)[number], StepHandler> = {
    agent: runAgent,
    'gate-human': async (ctx) =>
      ctx.run.posture === 'autonomous' ? { status: 'done', result: { approved: 'autonomous' } } : { status: 'waiting-gate' },
    'gate-policy': runPolicy,
    'ci-loop': runCiLoop,
    'fan-out': runFanOut,
    join: runJoin,
    decide: runDecision,
  }
  for (const kind of BUILTIN_STEP_KINDS) registry.registerStepKind(kind, stepKinds[kind])

  async function runAgent(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    let prompt = ctx.renderedPrompt
    if (ctx.def.requiresRun) {
      if (!services.deps.startRunTarget) return { status: 'failed', error: `Run target '${ctx.def.requiresRun}' is unavailable.` }
      const target = await services.deps.startRunTarget(ctx.run.taskId, ctx.def.requiresRun)
      if (!target.ok) return { status: 'failed', error: `Could not start run target '${ctx.def.requiresRun}'.` }
      if (target.url) prompt = `${prompt}\n\nThe app is running at: ${target.url}`
    }
    const context = await services.deps.assembleContext(ctx.run.taskId, ctx.run.id)
    const inputs = context ? `${prompt}\n\n${context}` : prompt
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
    const result = await services.runHeadless(
      ctx.run.taskId,
      ctx.def,
      { prompt: ctx.renderedPrompt, model: ctx.def.model, schema, mode: 'ai', signal: ctx.signal, tools: { allow: [] } },
      ctx,
    )
    const outcome = headlessOutcome(result)
    if (outcome.status === 'done' && (!outcome.structured || typeof (outcome.structured as { verdict?: unknown }).verdict !== 'string')) {
      return { ...outcome, status: 'failed', error: `Decision '${ctx.def.name}' returned no scalar verdict.` }
    }
    return outcome
  }

  async function runPolicy(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const policy = ctx.def.policy ? registry.policies.get(ctx.def.policy) : undefined
    if (!policy) return { status: 'failed', error: `Unknown policy '${ctx.def.policy ?? ''}'.` }
    const verdict = await policy(ctx.run.taskId)
    return verdict.pass ? { status: 'done', result: verdict } : { status: 'failed', error: verdict.detail ?? `Policy '${ctx.def.policy}' failed.` }
  }

  async function runCiLoop(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const max = Math.min(ctx.def.maxIterations ?? 3, MAX_STEP_TURNS)
    let iteration = ctx.step.iteration
    let sessionId = ctx.step.sessionId ?? undefined
    for (;;) {
      if (ctx.signal.aborted) return { status: 'cancelled' }
      const failing = await services.deps.failingChecks(ctx.run.taskId)
      if (failing === '') return { status: 'done', result: { green: true, iterations: iteration }, sessionId }
      if (failing === null) return { status: 'failed', error: 'No checks to poll (no PR?).' }
      if (iteration >= max) return { status: 'safety-rail', error: `Safety rail: ${max} fix iterations exhausted.` }
      iteration += 1
      await services.setStep(ctx.step.id, { iteration })
      const result = await services.runHeadless(
        ctx.run.taskId,
        ctx.def,
        {
          prompt: `${ctx.renderedPrompt || 'Fix the failing CI checks, then commit and push.'}\n\nFailing checks:\n${failing}`,
          model: ctx.def.model,
          schema: ctx.def.schema,
          resumeSessionId: sessionId,
          signal: ctx.signal,
          tools: ctx.tools,
        },
        ctx,
      )
      sessionId = result.capture.sessionId ?? sessionId
      if (result.status !== 'ok') return headlessOutcome(result)
    }
  }

  async function runFanOut(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    if (!services.deps.createChildTask) return { status: 'failed', error: 'Fan-out unavailable (no child-task factory).' }
    const plan = await services.runHeadless(
      ctx.run.taskId,
      ctx.def,
      { prompt: ctx.renderedPrompt, model: ctx.def.model, schema: ctx.def.schema, signal: ctx.signal, tools: ctx.tools },
      ctx,
    )
    const structured = plan.capture.structuredOutput as { tasks?: { title: string; branch: string; prompt?: string }[] } | { title: string; branch: string; prompt?: string }[] | null
    const seeds = Array.isArray(structured) ? structured : structured?.tasks
    if (plan.status !== 'ok') return headlessOutcome(plan)
    if (!seeds?.length) return { status: 'failed', error: 'Plan emitted no task list.' }
    if (seeds.length > MAX_FAN_OUT_TASKS) return { status: 'safety-rail', error: `Fan-out exceeded the ${MAX_FAN_OUT_TASKS}-task ceiling.` }

    const childDef: WorkflowStepDef = { name: ctx.def.childStep?.name ?? 'child', ...ctx.def.childStep }
    const tools = intersectToolCeilings(ctx.tools, ctx.def.childStep?.tools)
    // Child prompts share the top-level templating contract: `${steps.<name>.output}` resolves
    // against completed earlier steps, not the literal token.
    let childPrompt: string
    try {
      childPrompt = renderWorkflowPrompt(childDef.prompt, (await services.steps(ctx.run.id)).filter((row) => row.parentStepId == null))
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : `Fan-out '${ctx.def.name}' has an invalid child template reference.` }
    }
    const children = await Promise.all(
      seeds.map(async (seed, index) => {
        const childTaskId = await services.deps.createChildTask!(ctx.run.taskId, seed)
        const rowId = randomUUID()
        await services.db.insert(schema.workflowSteps).values({
          id: rowId,
          runId: ctx.run.id,
          idx: ctx.step.idx,
          name: `${childDef.name}:${index + 1} ${seed.title}`.slice(0, 120),
          kind: 'agent',
          mode: 'headless',
          profileId: childDef.profileId ?? DEFAULT_PROFILE_ID,
          model: childDef.model ?? null,
          status: 'pending',
          parentStepId: ctx.step.id,
          inputsJson: JSON.stringify({ childTaskId, seed, tools }),
          createdAt: now() + index,
          updatedAt: now() + index,
        })
        return { childTaskId, rowId, seed }
      }),
    )
    services.changed()
    const outcomes = await Promise.all(children.map(runChild))
    return {
      status: 'done',
      result: { children: children.length, failed: outcomes.filter((ok) => !ok).length },
      structured: seeds,
      sessionId: plan.capture.sessionId,
      costUsd: plan.capture.costUsd,
    }

    async function runChild({ childTaskId, rowId, seed }: (typeof children)[number]): Promise<boolean> {
      const controller = new AbortController()
      const parentAbort = () => controller.abort()
      ctx.signal.addEventListener('abort', parentAbort, { once: true })
      services.registerActive(ctx.run.id, rowId, controller)
      try {
        const prompt = [childPrompt, seed.prompt ?? '', `Task: ${seed.title}`].filter(Boolean).join('\n\n')
        const result = await services.runHeadless(
          childTaskId,
          childDef,
          {
            prompt,
            model: childDef.model,
            schema: childDef.schema,
            signal: controller.signal,
            tools,
            // Queued children stay 'pending' until they hold a concurrency slot.
            onStart: () => services.setStep(rowId, { status: 'running' }),
          },
          // Rebind the step id AND the emit sink so child stream events land on the child row.
          { ...ctx, step: { ...ctx.step, id: rowId }, emit: ({ event }) => services.deps.emitStepEvent?.(ctx.run.id, rowId, event) },
        )
        const outcome = headlessOutcome(result)
        await services.setStep(rowId, {
          status: outcome.status === 'done' ? 'done' : outcome.status === 'cancelled' ? 'cancelled' : 'failed',
          resultJson: JSON.stringify({ status: result.status, result: result.capture.result, events: result.capture.events.slice(-100) }),
          structuredJson: result.capture.structuredOutput == null ? null : JSON.stringify(result.capture.structuredOutput),
          sessionId: result.capture.sessionId,
          costUsd: result.capture.costUsd,
          error: outcome.status === 'done' ? null : 'error' in outcome ? outcome.error : 'Child step failed.',
        })
        return outcome.status === 'done'
      } catch (error) {
        if (controller.signal.aborted) return false
        await services.setStep(rowId, { status: 'failed', error: error instanceof Error ? error.message : 'Child step failed.' })
        return false
      } finally {
        ctx.signal.removeEventListener('abort', parentAbort)
        services.unregisterActive(ctx.run.id, rowId)
      }
    }
  }

  async function runJoin(ctx: StepHandlerContext): Promise<StepHandlerOutcome> {
    const rows = (await services.steps(ctx.run.id)).filter((row) => row.parentStepId == null)
    const fanOut = rows.find((row) => row.name === ctx.def.joins && row.kind === 'fan-out')
    if (!fanOut) return { status: 'failed', error: `Dangling join '${ctx.def.joins ?? ''}'.` }
    const children = await services.childSteps(fanOut.id)
    const results = children.map((child) => ({
      name: child.name,
      status: child.status,
      structured: child.structuredJson ? (JSON.parse(child.structuredJson) as unknown) : null,
      childTaskId: child.inputsJson ? (JSON.parse(child.inputsJson) as { childTaskId?: string }).childTaskId : undefined,
    }))
    const failures = results.filter((result) => result.status !== 'done')
    if (failures.length) return { status: 'failed', error: `${failures.length}/${results.length} children failed.`, structured: { results, failures: failures.length } }
    return { status: 'done', structured: { results, failures: 0 }, handoff: JSON.stringify(results, null, 2) }
  }
}
