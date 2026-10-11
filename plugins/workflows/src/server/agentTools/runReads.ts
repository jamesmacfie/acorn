// `workflow_read` and `workflow_wait` (docs/agent-tools/workflow-tools.md § Reading runs). A session
// reads the runs it launched and the workflow it belongs to, with their child runs. Every other ID,
// a real one included, answers exactly as an unknown one does.
//
// The projection is bounded and holds no prompt, transcript, record body, or provider payload. Step
// outputs and declared outputs are agent-produced data: they come back untrusted, a value the secret
// detector flags is withheld rather than returned, and a value too large to fit is withheld whole
// rather than cut.
import { eq } from 'drizzle-orm'
import { scanSecretText, ToolError, type ToolContext } from '@acorn/plugin-api/node'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { AgentRequestsCapability } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { workflowRuns, workflowSteps } from '../../node/schema'
import type { WorkflowChildRunSummary } from '../../shared/api'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { rowIdentity } from '../../shared/workflowIdentity'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import { workflowOutputs } from '../validation/values'
import { requireManagedCaller, type CallerLookup } from './caller'
import { boundedPage, MAX_TOOL_RESPONSE_BYTES } from './discovery'
import { runTarget, type WorkflowAgentLaunches } from './launches'
import { MAX_WAIT_MS } from './tools'

type RunRow = typeof workflowRuns.$inferSelect
type StepRow = typeof workflowSteps.$inferSelect

export const MAX_STEP_SUMMARIES = 100
const MAX_VALUE_BYTES = 16 * 1024
const MAX_TEXT = 1_000
const POLL_MS = 500

export type WorkflowRunReadDeps = {
  db: import('@acorn/plugin-api/node').PluginDatabase
  launches: WorkflowAgentLaunches
  caller: CallerLookup
  childRuns(stepId: string): Promise<WorkflowChildRunSummary[]>
  requests(): AgentRequestsCapability | undefined
}

type Attention = {
  kind: 'gate' | 'question' | 'failure' | 'safety-rail'
  step?: string
  detail?: string
  target: ReturnType<typeof runTarget> & { subresourceId?: string }
}
type Withheld = { name: string; reason: 'likely-secret' | 'too-large' }

const bounded = (text: string | null | undefined): string | undefined =>
  text
    ? text.length > MAX_TEXT
      ? `${text.slice(0, MAX_TEXT)}… (shortened; open the run for the rest)`
      : text
    : undefined

/** A value whole, or the reason it is not here. Never a shortened value posing as the real one. */
function shareable(value: DataValue): { value: DataValue } | { withheld: Withheld['reason'] } {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > MAX_VALUE_BYTES) return { withheld: 'too-large' }
  return scanSecretText(text, 'workflow-output').length ? { withheld: 'likely-secret' } : { value }
}

function shareAll(values: Record<string, DataValue>): { values: Record<string, DataValue>; withheld: Withheld[] } {
  const out: Record<string, DataValue> = {}
  const withheld: Withheld[] = []
  for (const [name, value] of Object.entries(values)) {
    const shared = shareable(value)
    if ('value' in shared) out[name] = shared.value
    else withheld.push({ name, reason: shared.withheld })
  }
  return { values: out, withheld }
}

const TERMINAL = new Set(['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled', 'not-started'])

export class WorkflowRunReads {
  constructor(private readonly deps: WorkflowRunReadDeps) {}

  /** The run, if this caller may read it. `launch` is set when this session launched the tree. */
  private async permitted(runId: string, context: ToolContext) {
    const caller = await requireManagedCaller(this.deps.caller, context)
    const run = this.deps.db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).get()
    const own = this.deps.launches.bySession(context.taskId, caller.sessionId)
    const enclosing = caller.workflowRunId
      ? this.deps.db
          .select({ rootRunId: workflowRuns.rootRunId })
          .from(workflowRuns)
          .where(eq(workflowRuns.id, caller.workflowRunId))
          .get()?.rootRunId
      : undefined
    const root = run ? (run.rootRunId ?? run.id) : runId
    const launch = own.find((candidate) => candidate.id === root)
    // A launch not yet started has no run row, so only its own receipt makes it readable.
    if (!launch && (!run || root !== enclosing)) throw new ToolError('not_found', 'No run you may read has that ID.')
    return { run: run ?? null, launch: launch ?? null }
  }

  private async attention(run: RunRow, steps: StepRow[]): Promise<Attention[]> {
    const items: Attention[] = steps
      .filter((step) => step.status === 'waiting-gate')
      .map((step) => ({
        kind: 'gate',
        step: step.name,
        target: { ...runTarget(run.id, run.taskId), subresourceId: step.id },
      }))
    const sessions = new Map(
      steps.flatMap((step) => (step.agentSessionId ? [[step.agentSessionId, step] as const] : [])),
    )
    if (sessions.size) {
      const pending =
        (await this.deps
          .requests()
          ?.list({ taskId: run.taskId })
          .catch(() => [])) ?? []
      for (const request of pending) {
        const step = sessions.get(request.sessionId)
        if (step && request.status === 'pending') {
          items.push({
            kind: 'question',
            step: step.name,
            detail: bounded(request.title),
            target: { ...runTarget(run.id, run.taskId), subresourceId: step.id },
          })
        }
      }
    }
    if (run.status === 'failed' || run.status === 'safety-rail') {
      items.push({
        kind: run.status === 'failed' ? 'failure' : 'safety-rail',
        detail: bounded(run.error),
        target: runTarget(run.id, run.taskId),
      })
    }
    return items
  }

  private async snapshot(runId: string, context: ToolContext) {
    const { run, launch } = await this.permitted(runId, context)
    if (!run) {
      // Admitted, not started: waiting for the caller's turn, or refused at dispatch.
      const status =
        launch!.state === 'awaiting-caller'
          ? 'awaiting-caller'
          : launch!.state === 'cancelled'
            ? 'cancelled'
            : 'not-started'
      return {
        run: null,
        steps: [] as StepRow[],
        summary: {
          runId,
          status,
          ...(launch!.error ? { error: launch!.error } : {}),
          launch: { state: launch!.state, admittedAt: launch!.createdAt },
          attention: [] as Attention[],
          observation: workflowContentFingerprint({ status, error: launch!.error }).slice(0, 16),
          target: runTarget(runId, launch!.taskId),
        },
      }
    }
    const steps = this.deps.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, run.id))
      .all()
      .sort((left, right) => left.idx - right.idx)
    const attention = await this.attention(run, steps)
    return {
      run,
      steps,
      summary: {
        runId: run.id,
        name: run.name,
        status: run.status,
        ...(run.error ? { error: bounded(run.error) } : {}),
        ...(launch ? { launch: { state: launch.state, admittedAt: launch.createdAt } } : {}),
        posture: run.posture,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        deadlineAt: run.deadlineAt,
        effective: { budget: JSON.parse(run.effectiveBudgetJson), tools: JSON.parse(run.effectiveToolsJson) },
        attention,
        observation: workflowContentFingerprint({
          status: run.status,
          steps: steps.map((step) => [step.id, step.status]),
          attention: attention.map((item) => [item.kind, item.step]),
        }).slice(0, 16),
        target: runTarget(run.id, run.taskId),
      },
    }
  }

  private async stepSummary(run: RunRow, def: WorkflowDef, step: StepRow) {
    const children = ['workflow', 'workflow-map'].includes(step.kind) ? await this.deps.childRuns(step.id) : []
    return {
      stepId: step.id,
      id: rowIdentity(def, step),
      name: step.name,
      kind: step.kind,
      status: step.status,
      ...(step.error ? { error: bounded(step.error) } : {}),
      ...(children.length
        ? {
            children: children.map((child) => ({
              runId: child.runId,
              name: child.name,
              status: child.runStatus ?? child.dispatchState,
              target: runTarget(child.runId, child.taskId),
            })),
          }
        : {}),
      target: { ...runTarget(run.id, run.taskId), subresourceId: step.id },
    }
  }

  // ─── workflow_read ────────────────────────────────────────────────────────────────────────────

  async read(input: { runId: string; step?: string; cursor?: string }, context: ToolContext) {
    const { run, steps, summary } = await this.snapshot(input.runId, context)
    if (!run) return summary
    const def = JSON.parse(run.defJson) as WorkflowDef
    if (input.step) {
      const step = steps.find((candidate) => candidate.id === input.step || rowIdentity(def, candidate) === input.step)
      if (!step) throw new ToolError('not_found', `No step '${input.step}' in this run.`)
      const output = step.structuredJson ? shareable(JSON.parse(step.structuredJson) as DataValue) : null
      return {
        ...summary,
        step: {
          ...(await this.stepSummary(run, def, step)),
          ...(output && 'value' in output ? { output: output.value } : {}),
          ...(output && 'withheld' in output ? { outputWithheld: output.withheld } : {}),
        },
      }
    }
    const summaries = await Promise.all(steps.map((step) => this.stepSummary(run, def, step)))
    let outputs: ReturnType<typeof shareAll> | null = null
    let outputsError: string | undefined
    if (run.status === 'done' || run.status === 'completed-with-failures') {
      try {
        outputs = shareAll(workflowOutputs(def, steps))
      } catch (error) {
        outputsError = bounded(error instanceof Error ? error.message : String(error))
      }
    }
    const room = MAX_TOOL_RESPONSE_BYTES - Buffer.byteLength(JSON.stringify({ summary, outputs })) - 2048
    const page = boundedPage(
      summaries,
      (item) => String(steps.find((step) => step.id === item.stepId)!.idx).padStart(6, '0'),
      input.cursor,
      MAX_STEP_SUMMARIES,
      Math.max(room, 4096),
    )
    return {
      ...summary,
      steps: page.items,
      nextCursor: page.nextCursor,
      ...(outputs
        ? { outputs: outputs.values, ...(outputs.withheld.length ? { outputsWithheld: outputs.withheld } : {}) }
        : {}),
      ...(outputsError ? { outputsError } : {}),
    }
  }

  // ─── workflow_wait ────────────────────────────────────────────────────────────────────────────

  async wait(input: { runId: string; after?: string; timeoutMs?: number }, context: ToolContext) {
    const deadline = Date.now() + Math.min(input.timeoutMs ?? MAX_WAIT_MS, MAX_WAIT_MS)
    let baseline = input.after
    for (;;) {
      const { summary } = await this.snapshot(input.runId, context)
      if (summary.status === 'awaiting-caller') {
        return {
          reason: 'awaiting-caller',
          next: 'The run starts after this turn ends. End your turn; read it again later.',
          ...summary,
        }
      }
      if (TERMINAL.has(summary.status)) return { reason: 'finished', ...summary }
      if (baseline === undefined) {
        if (summary.attention.length)
          return {
            reason: 'attention',
            next: 'A person needs to act. Tell them what the run needs, then end your turn.',
            ...summary,
          }
        baseline = summary.observation
      } else if (summary.observation !== baseline) {
        return summary.attention.length
          ? {
              reason: 'attention',
              next: 'A person needs to act. Tell them what the run needs, then end your turn.',
              ...summary,
            }
          : { reason: 'changed', ...summary }
      }
      if (Date.now() >= deadline || context.signal?.aborted) return { reason: 'timeout', ...summary }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(POLL_MS, Math.max(0, deadline - Date.now())))
        context.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      })
    }
  }
}
