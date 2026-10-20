// Workflow triggers: what the owner approved to start a published workflow with nobody present
// (docs/workflows/triggers.md). This class composes the parts. Approval decides what may run, the
// occurrence ledger runs it exactly once, and the clock kind says when.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { CompiledCoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { ScheduleSkipped } from '@acorn/plugin-api/node'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { Cadence, ScheduleRow } from '@acorn/protocol/schedules.ts'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph } from '../../shared/workflowContracts'
import type {
  WorkflowTriggerDraftInput,
  WorkflowTriggerFirstCheck,
  WorkflowTriggerPreparation,
  WorkflowTriggerState,
  WorkflowTriggerView,
  WorkflowTriggerWhen,
} from '../../shared/workflowTriggers'
import type { WorkflowStartService } from '../runs/admission'
import {
  freezeApproval,
  moveToReview,
  resolveTriggerGraph,
  stillApproved,
  triggerChanges,
  type TriggerResolver,
} from './approval'
import {
  clockOccurrence,
  clockWhen,
  configuredLoops,
  settleClockRun,
  startBaseline,
  type ClockContext,
  type TriggerSourceDescriber,
} from './clock'
import { effectiveTriggerLimits } from './limits'
import { TriggerOccurrences, type Trigger } from './occurrences'
import { workflowTriggerView } from './readModel'

/** The core scheduler, which times a clock trigger through its `workflow` target. */
export type WorkflowTriggerScheduler = {
  list(): Promise<ScheduleRow[]>
  create(input: { name: string; kind: string; target: unknown; cadence: Cadence }): Promise<ScheduleRow>
  patch(key: string, input: { enabled?: boolean; cadence?: Cadence; name?: string }): Promise<ScheduleRow>
  runNow(key: string, requestKey?: string): Promise<unknown>
  wake(key: string, options: { minGapMs: number }): void
  remove(key: string): Promise<void>
}

const state = (row: Trigger): WorkflowTriggerState => row.state as WorkflowTriggerState

export class WorkflowTriggerService {
  readonly #resolver: TriggerResolver
  readonly #occurrences: TriggerOccurrences

  constructor(
    private readonly db: PluginDatabase,
    starts: WorkflowStartService,
    core: Pick<CompiledCoreServices, 'tasks' | 'projects'>,
    private readonly reconciled: Promise<void>,
    private readonly editor: {
      describeSource?: TriggerSourceDescriber
      scheduler?: () => WorkflowTriggerScheduler
    } = {},
  ) {
    this.#resolver = { starts, describeSource: editor.describeSource }
    const review = (id: string, error: string, reason?: Parameters<typeof moveToReview>[3]) =>
      moveToReview(db, id, error, reason)
    this.#occurrences = new TriggerOccurrences({
      db,
      starts,
      tasks: core.tasks,
      stillApproved: (row, payload) => stillApproved(this.#resolver, row, configuredLoops(row), payload),
      moveToReview: review,
      settled: async (occurrence, run) => {
        if (settleClockRun(db, occurrence, run, review)) await this.enable(occurrence.triggerId)
      },
    })
  }

  get(id: string): Trigger | null {
    return this.db.select().from(schema.workflowTriggers).where(eq(schema.workflowTriggers.id, id)).get() ?? null
  }

  list(): Trigger[] {
    return this.db.select().from(schema.workflowTriggers).all()
  }

  /** Saves the setup. An approved trigger keeps its approval, waiting in Needs review for the owner. */
  save(input: WorkflowTriggerDraftInput): Trigger {
    const when = clockWhen(input.when)
    if (!input.projectId.trim() || !input.workflowId.trim() || !when) {
      throw new Error('A workflow trigger needs a project, published workflow, and valid IANA timezone.')
    }
    const id = input.id ?? randomUUID()
    const at = Date.now()
    const existing = this.get(id)
    if (existing && state(existing) === 'deleted') throw new Error('Deleted workflow trigger IDs cannot be reused.')
    const values = {
      id,
      schedulerKey: existing?.schedulerKey ?? null,
      workspaceId: existing?.workspaceId ?? '',
      projectId: input.projectId,
      workflowId: input.workflowId,
      whenJson: JSON.stringify(when),
      inputsJson: JSON.stringify(input.inputs ?? {}),
      limitsJson: JSON.stringify(input.limits ?? {}),
      loopsJson: JSON.stringify(input.loops ?? (existing ? configuredLoops(existing) : [])),
      approvedGraphJson: existing?.approvedGraphJson ?? null,
      approvedGraphDigest: existing?.approvedGraphDigest ?? null,
      generation: existing?.generation ?? 0,
      epoch: existing?.epoch ?? randomUUID(),
      state: existing?.approvedGraphJson ? 'needs-review' : 'draft',
      firstCheck: existing?.firstCheck ?? 'process-current',
      error: null,
      errorReason: null,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }
    if (existing) this.db.update(schema.workflowTriggers).set(values).where(eq(schema.workflowTriggers.id, id)).run()
    else this.db.insert(schema.workflowTriggers).values(values).run()
    return this.get(id)!
  }

  /** Saves, then keeps the core scheduler row in step with the cadence, paused until approval. */
  async saveManaged(input: WorkflowTriggerDraftInput): Promise<WorkflowTriggerView> {
    const row = this.save(input)
    const scheduler = this.editor.scheduler?.()
    if (!scheduler || !input.cadence) return this.view(row)
    let schedulerKey = row.schedulerKey
    if (!schedulerKey) {
      const created = await scheduler.create({
        name: input.name?.trim() || 'Workflow trigger',
        kind: 'workflow',
        target: { triggerId: row.id },
        cadence: input.cadence,
      })
      schedulerKey = created.key
      this.db.update(schema.workflowTriggers).set({ schedulerKey }).where(eq(schema.workflowTriggers.id, row.id)).run()
    }
    await scheduler.patch(schedulerKey, {
      enabled: false,
      cadence: input.cadence,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    })
    return this.view(this.require(row.id))
  }

  async prepare(input: WorkflowTriggerDraftInput): Promise<WorkflowTriggerPreparation> {
    if (!this.editor.describeSource) throw new Error('Trigger source review is unavailable.')
    const row = input.id ? this.get(input.id) : null
    const resolved = await resolveTriggerGraph(
      this.#resolver,
      input,
      input.inputs ?? {},
      input.loops ?? (row ? configuredLoops(row) : []),
    )
    const approved = row?.approvedGraphJson ? (JSON.parse(row.approvedGraphJson) as ResolvedWorkflowGraph) : null
    return {
      workflowName: resolved.graph.root.name,
      limits: effectiveTriggerLimits(resolved.graph, input.limits),
      loops: resolved.loops,
      changes: triggerChanges(approved, resolved.graph),
    }
  }

  async approve(id: string, firstCheck: WorkflowTriggerFirstCheck, freshEpoch = false): Promise<Trigger> {
    const row = this.require(id)
    if (state(row) === 'deleted') throw new Error('Deleted triggers cannot be approved.')
    await this.#occurrences.reconcile(id)
    if (this.#occurrences.active(id)) throw new Error('Wait for the active workflow run before changing approval.')
    const requestedInputs = JSON.parse(row.inputsJson) as Record<string, DataValue>
    const resolved = await resolveTriggerGraph(this.#resolver, row, requestedInputs, configuredLoops(row))
    const limits = effectiveTriggerLimits(resolved.graph, JSON.parse(row.limitsJson))
    freezeApproval(this.db, row, { ...resolved, limits }, requestedInputs, firstCheck, freshEpoch)
    if (firstCheck === 'track-now') await startBaseline(this.db, this.#occurrences, this.require(id))
    else if (row.schedulerKey) await this.editor.scheduler?.().patch(row.schedulerKey, { enabled: true })
    return this.require(id)
  }

  async pause(id: string, paused: boolean): Promise<WorkflowTriggerView> {
    const row = this.require(id)
    if (state(row) !== 'active') throw new Error('Only an active trigger can be paused or resumed.')
    if (!row.schedulerKey) throw new Error('Save the trigger setup before changing its status.')
    await this.editor.scheduler?.().patch(row.schedulerKey, { enabled: !paused })
    return this.view(row)
  }

  async runNow(id: string): Promise<WorkflowTriggerView> {
    const row = this.require(id)
    if (state(row) !== 'active') throw new Error('Approve the trigger before running it.')
    if (!row.schedulerKey) throw new Error('Activate the trigger before running it.')
    await this.editor.scheduler?.().runNow(row.schedulerKey)
    return this.view(row)
  }

  /** Removing the scheduler row calls back into `remove` through the target. */
  async deleteManaged(id: string): Promise<{ deleted: true }> {
    const row = this.require(id)
    if (row.schedulerKey) await this.editor.scheduler?.().remove(row.schedulerKey)
    else await this.remove(id)
    return { deleted: true }
  }

  async views(): Promise<WorkflowTriggerView[]> {
    return Promise.all(
      this.list()
        .filter((row) => state(row) !== 'deleted')
        .map((row) => this.view(row)),
    )
  }

  async view(rowOrId: Trigger | string): Promise<WorkflowTriggerView> {
    const row = typeof rowOrId === 'string' ? this.require(rowOrId) : rowOrId
    return workflowTriggerView(this.db, row, this.editor.scheduler?.())
  }

  when(id: string): WorkflowTriggerWhen | undefined {
    const row = this.get(id)
    return row && state(row) !== 'deleted' ? (JSON.parse(row.whenJson) as WorkflowTriggerWhen) : undefined
  }

  /** One firing of the core scheduler. Skips, rather than fails, when the trigger can't run now. */
  async dispatch(id: string, context: ClockContext): Promise<string> {
    await this.reconciled
    await this.#occurrences.reconcile(id)
    const row = this.require(id)
    if (state(row) !== 'active') throw new ScheduleSkipped(row.error ?? `Workflow trigger is ${state(row)}.`)
    const occurrence = this.#occurrences.reserve(row, clockOccurrence(row, context))
    if (occurrence.state === 'skipped') throw new ScheduleSkipped(occurrence.detail ?? 'previous run still active')
    const started = await this.#occurrences.resume(occurrence)
    return `started workflow task ${started.taskId}, run ${started.runId}`
  }

  /** Keeps a tombstone, so the ID can't be reused, and leaves runs already started alone. */
  async remove(id: string): Promise<void> {
    if (!this.get(id)) return
    this.db
      .update(schema.workflowTriggers)
      .set({ state: 'deleted', updatedAt: Date.now() })
      .where(eq(schema.workflowTriggers.id, id))
      .run()
  }

  settleRun(runId: string): Promise<void> {
    return this.#occurrences.settleRun(runId)
  }

  reconcile(triggerId?: string): Promise<void> {
    return this.#occurrences.reconcile(triggerId)
  }

  private async enable(id: string): Promise<void> {
    const key = this.get(id)?.schedulerKey
    if (key) await this.editor.scheduler?.().patch(key, { enabled: true })
  }

  private require(id: string): Trigger {
    const row = this.get(id)
    if (!row) throw new Error('Workflow trigger not found.')
    return row
  }
}

/** Core's stored rows keep the target they were created with, so the old key still parses. */
export function parseWorkflowTriggerTarget(raw: unknown): { triggerId: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const target = raw as { triggerId?: unknown; scheduleId?: unknown }
  // shortcut: `scheduleId` is the key core's user_schedules rows stored before triggers; drop it
  // when no stored row uses it.
  const triggerId = target.triggerId ?? target.scheduleId
  return typeof triggerId === 'string' && triggerId.trim() ? { triggerId } : null
}
