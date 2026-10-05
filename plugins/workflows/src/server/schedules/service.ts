import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { CompiledCoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { ScheduleSkipped } from '@acorn/plugin-api/node'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { Cadence, ScheduleRow } from '@acorn/protocol/schedules.ts'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph } from '../../shared/workflowContracts'
import type {
  WorkflowScheduleDraftInput,
  WorkflowScheduleFirstCheck,
  WorkflowScheduleLoopSetting,
  WorkflowScheduleLimits,
  WorkflowSchedulePreparation,
  WorkflowSchedulePayload,
  WorkflowScheduleState,
  WorkflowScheduleView,
} from '../../shared/workflowSchedules'
import {
  applyScheduleLoopSettings,
  effectiveScheduleLimits,
  describeScheduleLoops,
  scheduleChanges,
  type ScheduleSourceDescriber,
} from './model'
import { workflowScheduleView } from './readModel'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import type { WorkflowStartService } from '../runs/admission'

const ACTIVE_RUN = ['running', 'gated', 'cancelling'] as const
const ACTIVE_OCCURRENCE = ['claimed', 'task-created', 'run-started'] as const

type RunContext = { reason: 'due' | 'manual' | 'catch-up'; dueAt?: number; requestKey?: string }
type Occurrence = typeof schema.workflowScheduleOccurrences.$inferSelect
type Schedule = typeof schema.workflowSchedules.$inferSelect

export type WorkflowScheduleScheduler = {
  list(): Promise<ScheduleRow[]>
  create(input: { name: string; kind: string; target: unknown; cadence: Cadence }): Promise<ScheduleRow>
  patch(key: string, input: { enabled?: boolean; cadence?: Cadence; name?: string }): Promise<ScheduleRow>
  runNow(key: string, requestKey?: string): Promise<unknown>
  remove(key: string): Promise<void>
}

const validTimezone = (timezone: string): boolean => {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); return true } catch { return false }
}

const frozenInputs = (graph: ResolvedWorkflowGraph, supplied: Record<string, DataValue>): Record<string, DataValue> => ({
  ...Object.fromEntries((graph.root.inputs ?? []).flatMap(input => input.default === undefined ? [] : [[input.name, input.default]])),
  ...supplied,
})

function applyLimits(graph: ResolvedWorkflowGraph, limits: WorkflowScheduleLimits): ResolvedWorkflowGraph {
  const root = { ...graph.root, maxDescendants: limits.maxDescendants, maxConcurrency: limits.maxConcurrency, budget: limits.budget }
  const nodes = graph.nodes.map((node, index) => index === 0 ? { ...node, definition: root } : node)
  return { ...graph, root, nodes, fingerprint: workflowContentFingerprint(nodes.map(({ path, definition, provenance, defaultInputs }) => ({ path, definition, provenance, defaultInputs }))) }
}

const state = (row: Schedule): WorkflowScheduleState => row.state as WorkflowScheduleState

const admissionNeedsReview = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /forbidden|connection-required|not published|no longer exists|must be reviewed and trusted|select .+ before running/i.test(message)
}

export class WorkflowScheduleService {
  constructor(
    private readonly db: PluginDatabase,
    private readonly starts: WorkflowStartService,
    private readonly core: Pick<CompiledCoreServices, 'tasks' | 'projects'>,
    private readonly reconciled: Promise<void>,
    private readonly editor: {
      describeSource?: ScheduleSourceDescriber
      scheduler?: () => WorkflowScheduleScheduler
    } = {},
  ) {}

  get(id: string): Schedule | null {
    return this.db.select().from(schema.workflowSchedules).where(eq(schema.workflowSchedules.id, id)).get() ?? null
  }

  list(): Schedule[] {
    return this.db.select().from(schema.workflowSchedules).all()
  }

  private configuredLoops(row: Schedule): WorkflowScheduleLoopSetting[] {
    return JSON.parse(row.loopsJson || '[]') as WorkflowScheduleLoopSetting[]
  }

  save(input: WorkflowScheduleDraftInput): Schedule {
    if (!input.projectId.trim() || !input.workflowId.trim() || !validTimezone(input.timezone)) {
      throw new Error('A workflow schedule needs a project, published workflow, and valid IANA timezone.')
    }
    const id = input.id ?? randomUUID()
    const at = Date.now()
    const existing = this.get(id)
    if (existing && state(existing) === 'deleted') throw new Error('Deleted workflow schedule IDs cannot be reused.')
    const values = {
      id,
      schedulerKey: existing?.schedulerKey ?? null,
      workspaceId: existing?.workspaceId ?? '',
      projectId: input.projectId,
      workflowId: input.workflowId,
      inputsJson: JSON.stringify(input.inputs ?? {}),
      timezone: input.timezone,
      limitsJson: JSON.stringify(input.limits ?? {}),
      loopsJson: JSON.stringify(input.loops ?? (existing ? this.configuredLoops(existing) : [])),
      approvedGraphJson: existing?.approvedGraphJson ?? null,
      approvedGraphDigest: existing?.approvedGraphDigest ?? null,
      generation: existing?.generation ?? 0,
      epoch: existing?.epoch ?? randomUUID(),
      state: existing?.approvedGraphJson ? 'needs-review' : 'draft',
      firstCheck: existing?.firstCheck ?? 'process-current',
      error: null,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }
    if (existing) this.db.update(schema.workflowSchedules).set(values).where(eq(schema.workflowSchedules.id, id)).run()
    else this.db.insert(schema.workflowSchedules).values(values).run()
    return this.get(id)!
  }

  async saveManaged(input: WorkflowScheduleDraftInput): Promise<WorkflowScheduleView> {
    const row = this.save(input)
    const scheduler = this.editor.scheduler?.()
    if (!scheduler || !input.cadence) return this.view(row)
    let schedulerKey = row.schedulerKey
    if (!schedulerKey) {
      const created = await scheduler.create({
        name: input.name?.trim() || 'Scheduled workflow',
        kind: 'workflow',
        target: { scheduleId: row.id },
        cadence: input.cadence,
      })
      schedulerKey = created.key
      this.db.update(schema.workflowSchedules).set({ schedulerKey }).where(eq(schema.workflowSchedules.id, row.id)).run()
    }
    await scheduler.patch(schedulerKey, {
      enabled: false,
      cadence: input.cadence,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    })
    return this.view(this.require(row.id))
  }

  async prepare(input: WorkflowScheduleDraftInput): Promise<WorkflowSchedulePreparation> {
    if (!this.editor.describeSource) throw new Error('Schedule source review is unavailable.')
    const prepared = await this.starts.prepareScheduled(input.projectId, input.workflowId, input.inputs ?? {})
    const supplied = frozenInputs(prepared.graph, input.inputs ?? {})
    const row = input.id ? this.get(input.id) : null
    const loops = await describeScheduleLoops(prepared.graph, prepared.scope, supplied, this.editor.describeSource, input.loops ?? (row ? this.configuredLoops(row) : []))
    const approved = row?.approvedGraphJson ? JSON.parse(row.approvedGraphJson) as ResolvedWorkflowGraph : null
    const configured = loops.length ? applyScheduleLoopSettings(prepared.graph, loops, input.loops ?? (row ? this.configuredLoops(row) : [])) : prepared.graph
    return {
      workflowName: prepared.graph.root.name,
      limits: effectiveScheduleLimits(prepared.graph, input.limits),
      loops,
      changes: scheduleChanges(approved, configured),
    }
  }

  async approve(id: string, firstCheck: WorkflowScheduleFirstCheck, freshEpoch = false): Promise<Schedule> {
    const row = this.require(id)
    if (state(row) === 'deleted') throw new Error('Deleted schedules cannot be approved.')
    await this.reconcile(id)
    if (this.activeOccurrence(id)) throw new Error('Wait for the active workflow run before changing approval.')
    const requestedInputs = JSON.parse(row.inputsJson) as Record<string, DataValue>
    const prepared = await this.starts.prepareScheduled(row.projectId, row.workflowId, requestedInputs)
    const limits = effectiveScheduleLimits(prepared.graph, JSON.parse(row.limitsJson))
    const available = this.editor.describeSource
      ? await describeScheduleLoops(prepared.graph, prepared.scope, frozenInputs(prepared.graph, requestedInputs), this.editor.describeSource, this.configuredLoops(row))
      : []
    const configuredGraph = available.length
      ? applyScheduleLoopSettings(prepared.graph, available, this.configuredLoops(row))
      : prepared.graph
    const graph = applyLimits(configuredGraph, limits)
    const generation = row.generation + 1
    const epoch = freshEpoch ? randomUUID() : row.epoch
    this.db.update(schema.workflowSchedules).set({
      workspaceId: prepared.scope.workspaceId,
      inputsJson: JSON.stringify(frozenInputs(graph, requestedInputs)),
      limitsJson: JSON.stringify(limits),
      approvedGraphJson: JSON.stringify(graph),
      approvedGraphDigest: graph.fingerprint,
      generation,
      epoch,
      state: firstCheck === 'track-now' ? 'baselining' : 'active',
      firstCheck,
      error: null,
      updatedAt: Date.now(),
    }).where(eq(schema.workflowSchedules.id, id)).run()
    if (firstCheck === 'track-now') {
      const occurrence = this.reserve(this.require(id), { reason: 'manual', requestKey: `baseline:${generation}` }, true)
      try {
        await this.resume(occurrence)
      } catch (error) {
        if (state(this.require(id)) !== 'needs-review') {
          this.db.update(schema.workflowSchedules).set({
            state: 'baseline-failed',
            error: error instanceof Error ? error.message : 'Baseline check could not start.',
            updatedAt: Date.now(),
          }).where(and(eq(schema.workflowSchedules.id, id), eq(schema.workflowSchedules.generation, generation))).run()
        }
        throw error
      }
    }
    if (firstCheck === 'process-current' && row.schedulerKey) await this.editor.scheduler?.().patch(row.schedulerKey, { enabled: true })
    return this.require(id)
  }

  async pause(id: string, paused: boolean): Promise<WorkflowScheduleView> {
    const row = this.require(id)
    if (state(row) !== 'active') throw new Error('Only an active schedule can be paused or resumed.')
    if (!row.schedulerKey) throw new Error('Save the schedule setup before changing its status.')
    await this.editor.scheduler?.().patch(row.schedulerKey, { enabled: !paused })
    return this.view(row)
  }

  async runNow(id: string): Promise<WorkflowScheduleView> {
    const row = this.require(id)
    if (state(row) !== 'active') throw new Error('Approve the schedule before running it.')
    if (!row.schedulerKey) throw new Error('Activate the schedule before running it.')
    await this.editor.scheduler?.().runNow(row.schedulerKey)
    return this.view(row)
  }

  async deleteManaged(id: string): Promise<{ deleted: true }> {
    const row = this.require(id)
    if (row.schedulerKey) await this.editor.scheduler?.().remove(row.schedulerKey)
    else await this.remove(id)
    return { deleted: true }
  }

  async views(): Promise<WorkflowScheduleView[]> {
    return Promise.all(this.list().filter(row => state(row) !== 'deleted').map(row => this.view(row)))
  }

  async view(rowOrId: Schedule | string): Promise<WorkflowScheduleView> {
    const row = typeof rowOrId === 'string' ? this.require(rowOrId) : rowOrId
    return workflowScheduleView(this.db, row, this.editor.scheduler?.())
  }

  timezone(id: string): string | undefined {
    const row = this.get(id)
    return row && state(row) !== 'deleted' ? row.timezone : undefined
  }

  async dispatch(id: string, context: RunContext): Promise<string> {
    await this.reconciled
    await this.reconcile(id)
    const row = this.require(id)
    if (state(row) !== 'active') throw new ScheduleSkipped(row.error ?? `Workflow schedule is ${state(row)}.`)
    const occurrence = this.reserve(row, context, false)
    if (occurrence.state === 'skipped') throw new ScheduleSkipped(occurrence.detail ?? 'previous run still active')
    const started = await this.resume(occurrence)
    return `started workflow task ${started.taskId}, run ${started.runId}`
  }

  async remove(id: string): Promise<void> {
    const row = this.get(id)
    if (!row) return
    this.db.update(schema.workflowSchedules).set({ state: 'deleted', updatedAt: Date.now() })
      .where(eq(schema.workflowSchedules.id, id)).run()
  }

  async settleRun(runId: string): Promise<void> {
    const occurrence = this.db.select().from(schema.workflowScheduleOccurrences)
      .where(eq(schema.workflowScheduleOccurrences.runId, runId)).get()
    if (!occurrence) return
    const run = this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).get()
    if (!run || ACTIVE_RUN.includes(run.status as typeof ACTIVE_RUN[number])) return
    // The root is the tree's schedule-overlap owner. Keep that ownership until every descendant
    // is terminal as well, even if a malformed/legacy runner settles the root prematurely.
    const activeDescendant = this.db.select({ id: schema.workflowRuns.id }).from(schema.workflowRuns).where(and(
      eq(schema.workflowRuns.rootRunId, runId), inArray(schema.workflowRuns.status, [...ACTIVE_RUN]),
    )).get()
    if (activeDescendant) return
    this.db.update(schema.workflowScheduleOccurrences).set({ state: 'terminal', detail: run.error, updatedAt: Date.now() })
      .where(eq(schema.workflowScheduleOccurrences.id, occurrence.id)).run()
    if (occurrence.kind === 'baseline') {
      const ok = run.status === 'done' || run.status === 'completed-with-failures'
      this.db.update(schema.workflowSchedules).set({
        state: ok ? 'active' : 'baseline-failed',
        error: ok ? null : run.error ?? 'Baseline check failed.',
        updatedAt: Date.now(),
      }).where(and(eq(schema.workflowSchedules.id, occurrence.scheduleId), eq(schema.workflowSchedules.generation, occurrence.generation))).run()
      if (ok) {
        const schedule = this.get(occurrence.scheduleId)
        if (schedule?.schedulerKey) await this.editor.scheduler?.().patch(schedule.schedulerKey, { enabled: true })
      }
    } else if (run.status === 'failed' && /expired|continuation|token/i.test(run.error ?? '')) {
      this.needsReview(occurrence.scheduleId, run.error ?? 'Incremental continuation needs review.')
    }
  }

  async reconcile(scheduleId?: string): Promise<void> {
    const rows = this.db.select().from(schema.workflowScheduleOccurrences)
      .where(scheduleId
        ? and(eq(schema.workflowScheduleOccurrences.scheduleId, scheduleId), inArray(schema.workflowScheduleOccurrences.state, [...ACTIVE_OCCURRENCE]))
        : inArray(schema.workflowScheduleOccurrences.state, [...ACTIVE_OCCURRENCE]))
      .all()
    for (const row of rows) {
      if (row.state === 'run-started') await this.settleRun(row.runId)
      else await this.resume(row)
    }
  }

  private reserve(row: Schedule, context: RunContext, baseline: boolean): Occurrence {
    if (context.reason !== 'manual' && context.dueAt === undefined) throw new Error('Scheduled occurrences require their persisted due instant.')
    const requestKey = baseline ? context.requestKey! : context.reason === 'manual'
      ? `manual:${context.requestKey ?? randomUUID()}`
      : `due:${row.generation}:${context.dueAt}`
    const graph = JSON.parse(row.approvedGraphJson!) as ResolvedWorkflowGraph
    const payload: WorkflowSchedulePayload = {
      graph,
      inputs: JSON.parse(row.inputsJson),
      limits: JSON.parse(row.limitsJson),
      baseline,
    }
    const fingerprint = workflowContentFingerprint({ scheduleId: row.id, generation: row.generation, requestKey, payload })
    return this.db.transaction(tx => {
      const existing = tx.select().from(schema.workflowScheduleOccurrences).where(and(
        eq(schema.workflowScheduleOccurrences.scheduleId, row.id), eq(schema.workflowScheduleOccurrences.requestKey, requestKey),
      )).get()
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint) throw new Error('Occurrence request key was reused with different content.')
        return existing
      }
      const active = tx.select().from(schema.workflowScheduleOccurrences).where(and(
        eq(schema.workflowScheduleOccurrences.scheduleId, row.id), inArray(schema.workflowScheduleOccurrences.state, [...ACTIVE_OCCURRENCE]),
      )).get()
      const at = Date.now()
      const values = {
        id: randomUUID(), scheduleId: row.id, generation: row.generation,
        kind: baseline ? 'baseline' : context.reason,
        dueAt: context.dueAt ?? null, requestKey, payloadFingerprint: fingerprint,
        payloadJson: JSON.stringify(payload), taskId: randomUUID(), runId: randomUUID(),
        state: active ? 'skipped' : 'claimed',
        detail: active ? `Skipped: previous run still active (${active.runId}).` : null,
        createdAt: at, updatedAt: at,
      }
      tx.insert(schema.workflowScheduleOccurrences).values(values).run()
      return values as Occurrence
    })
  }

  private async resume(initial: Occurrence): Promise<Occurrence> {
    let row = this.db.select().from(schema.workflowScheduleOccurrences).where(eq(schema.workflowScheduleOccurrences.id, initial.id)).get() ?? initial
    if (!ACTIVE_OCCURRENCE.includes(row.state as typeof ACTIVE_OCCURRENCE[number])) return row
    const schedule = this.require(row.scheduleId)
    if (schedule.generation !== row.generation || ['deleted', 'needs-review'].includes(schedule.state)) {
      this.db.update(schema.workflowScheduleOccurrences).set({ state: 'blocked', detail: 'Schedule approval changed before dispatch.', updatedAt: Date.now() })
        .where(eq(schema.workflowScheduleOccurrences.id, row.id)).run()
      throw new ScheduleSkipped('schedule approval changed before dispatch')
    }
    const payload = JSON.parse(row.payloadJson) as WorkflowSchedulePayload
    if (row.state === 'claimed') {
      // Recheck project trust, source capability, connections, and the reviewed graph before the
      // first core effect. A transient failure leaves this exact intent for infrastructure retry.
      let current: Awaited<ReturnType<WorkflowStartService['prepareScheduled']>>
      try {
        current = await this.starts.prepareScheduled(schedule.projectId, schedule.workflowId, payload.inputs)
      } catch (error) {
        if (!admissionNeedsReview(error)) throw error
        const detail = error instanceof Error ? error.message : 'Workflow authority changed before dispatch.'
        this.needsReview(schedule.id, detail)
        this.db.update(schema.workflowScheduleOccurrences).set({ state: 'blocked', detail, updatedAt: Date.now() })
          .where(eq(schema.workflowScheduleOccurrences.id, row.id)).run()
        throw new ScheduleSkipped(detail)
      }
      const available = this.editor.describeSource
        ? await describeScheduleLoops(current.graph, current.scope, payload.inputs, this.editor.describeSource, this.configuredLoops(schedule))
        : []
      const currentGraph = available.length
        ? applyScheduleLoopSettings(current.graph, available, this.configuredLoops(schedule))
        : current.graph
      if (applyLimits(currentGraph, payload.limits).fingerprint !== schedule.approvedGraphDigest) {
        this.needsReview(schedule.id, 'Published workflow dependencies changed before dispatch.')
        this.db.update(schema.workflowScheduleOccurrences).set({ state: 'blocked', detail: 'Approval changed before dispatch.', updatedAt: Date.now() })
          .where(eq(schema.workflowScheduleOccurrences.id, row.id)).run()
        throw new ScheduleSkipped('workflow approval changed — review to resume')
      }
      await this.core.tasks.createRoot(schedule.projectId, {
        title: `${payload.graph.root.name} · scheduled`,
        branch: `workflow-${row.id.slice(0, 8)}`,
        origin: 'workflows:schedule',
      }, row.taskId)
      this.advance(row.id, 'claimed', 'task-created')
      row = this.db.select().from(schema.workflowScheduleOccurrences).where(eq(schema.workflowScheduleOccurrences.id, row.id)).get()!
    }
    if (row.state === 'task-created') {
      try {
        await this.starts.startScheduled({
          taskId: row.taskId,
          graph: payload.graph,
          intendedRunId: row.runId,
          callerKey: `schedule:${schedule.id}:occurrence:${row.id}`,
          payloadFingerprint: row.payloadFingerprint,
          inputs: payload.inputs,
          processingScope: { scopeId: schedule.id, epoch: schedule.epoch },
          baseline: payload.baseline,
        })
      } catch (error) {
        if (!admissionNeedsReview(error)) throw error
        const detail = error instanceof Error ? error.message : 'Workflow authority changed before start.'
        this.needsReview(schedule.id, detail)
        this.db.update(schema.workflowScheduleOccurrences).set({ state: 'blocked', detail, updatedAt: Date.now() })
          .where(eq(schema.workflowScheduleOccurrences.id, row.id)).run()
        throw new ScheduleSkipped(detail)
      }
      this.advance(row.id, 'task-created', 'run-started')
      row = this.db.select().from(schema.workflowScheduleOccurrences).where(eq(schema.workflowScheduleOccurrences.id, row.id)).get()!
    }
    return row
  }

  private advance(id: string, from: string, to: string): void {
    this.db.update(schema.workflowScheduleOccurrences).set({ state: to, detail: null, updatedAt: Date.now() })
      .where(and(eq(schema.workflowScheduleOccurrences.id, id), eq(schema.workflowScheduleOccurrences.state, from))).run()
  }

  private activeOccurrence(scheduleId: string): Occurrence | null {
    return this.db.select().from(schema.workflowScheduleOccurrences).where(and(
      eq(schema.workflowScheduleOccurrences.scheduleId, scheduleId), inArray(schema.workflowScheduleOccurrences.state, [...ACTIVE_OCCURRENCE]),
    )).get() ?? null
  }

  private needsReview(id: string, error: string): void {
    this.db.update(schema.workflowSchedules).set({ state: 'needs-review', error, updatedAt: Date.now() })
      .where(eq(schema.workflowSchedules.id, id)).run()
  }

  private require(id: string): Schedule {
    const row = this.get(id)
    if (!row) throw new Error('Workflow schedule not found.')
    return row
  }
}

export function parseWorkflowScheduleTarget(raw: unknown): { scheduleId: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const scheduleId = (raw as { scheduleId?: unknown }).scheduleId
  return typeof scheduleId === 'string' && scheduleId.trim() ? { scheduleId } : null
}
