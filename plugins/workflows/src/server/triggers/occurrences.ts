// The occurrence ledger: each time a trigger fires, one row reserves the task and run IDs before any
// effect, then advances through `claimed`, `task-created`, and `run-started`. Recovery after a crash
// resumes the same row with the same IDs, so a trigger never starts two runs for one decision.
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { CompiledCoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { ScheduleSkipped } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { ResolvedWorkflowGraph, WorkflowAuthorityReason } from '../../shared/workflowContracts'
import type { WorkflowTriggerPayload } from '../../shared/workflowTriggers'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import type { WorkflowTransaction } from '../dispatch/dispatcher'
import type { WorkflowStartService } from '../runs/admission'
import { WorkflowAuthorityError } from '../runs/authority'

const ACTIVE_RUN = ['running', 'gated', 'cancelling'] as const
export const ACTIVE_OCCURRENCE = ['claimed', 'task-created', 'run-started'] as const

export type Trigger = typeof schema.workflowTriggers.$inferSelect
export type Occurrence = typeof schema.workflowTriggerOccurrences.$inferSelect
type Run = typeof schema.workflowRuns.$inferSelect

export type OccurrenceRequest = {
  kind: 'due' | 'catch-up' | 'wake' | 'manual' | 'baseline' | 'record'
  requestKey: string
  dueAt?: number
  /** The overlap key with the trigger: occurrences that share both never run at once. */
  recordKey: string | null
  /** A record occurrence's own inputs and record. A clock occurrence takes the trigger's inputs. */
  inputs?: Record<string, DataValue>
  record?: WorkflowTriggerPayload['record']
  /** Why this occurrence can't start, recorded as `blocked` instead of claimed. */
  blocked?: string
}

type OccurrenceDeps = {
  db: PluginDatabase
  starts: Pick<WorkflowStartService, 'startTriggered'>
  tasks: Pick<CompiledCoreServices['tasks'], 'createRoot'>
  /** Whether the trigger would still start the graph it approved. Throws WorkflowAuthorityError when
   *  only the owner can fix what changed. */
  stillApproved(row: Trigger, payload: WorkflowTriggerPayload): Promise<boolean>
  moveToReview(id: string, error: string, reason?: WorkflowAuthorityReason): void
  /** A run tree finished. The trigger's kind decides what that means. */
  settled(occurrence: Occurrence, run: Run): Promise<void>
}

const isActive = (state: string): boolean => ACTIVE_OCCURRENCE.includes(state as (typeof ACTIVE_OCCURRENCE)[number])

export class TriggerOccurrences {
  constructor(private readonly deps: OccurrenceDeps) {}

  /** Reserves the occurrence for one request, or returns the one already reserved for it. A request
   *  that overlaps an active occurrence is recorded as `skipped`. */
  reserve(row: Trigger, request: OccurrenceRequest): Occurrence {
    return this.deps.db.transaction((tx) => this.reserveIn(tx, row, request))
  }

  /** `reserve` inside a caller's transaction, so a record check commits its ledger and its
   *  occurrences together. */
  reserveIn(tx: WorkflowTransaction, row: Trigger, request: OccurrenceRequest): Occurrence {
    const graph = JSON.parse(row.approvedGraphJson!) as ResolvedWorkflowGraph
    const payload: WorkflowTriggerPayload = {
      graph,
      inputs: request.inputs ?? JSON.parse(row.inputsJson),
      limits: JSON.parse(row.limitsJson),
      baseline: request.kind === 'baseline',
      ...(request.record ? { record: request.record } : {}),
    }
    // `scheduleId` is the key every stored fingerprint was made with. Renaming it would make a
    // replayed request look like a different one.
    const fingerprint = workflowContentFingerprint({
      scheduleId: row.id,
      generation: row.generation,
      requestKey: request.requestKey,
      payload,
    })
    const table = schema.workflowTriggerOccurrences
    const existing = tx
      .select()
      .from(table)
      .where(and(eq(table.triggerId, row.id), eq(table.requestKey, request.requestKey)))
      .get()
    if (existing) {
      if (existing.payloadFingerprint !== fingerprint)
        throw new Error('Occurrence request key was reused with different content.')
      return existing
    }
    const active = tx
      .select()
      .from(table)
      .where(
        and(
          eq(table.triggerId, row.id),
          request.recordKey === null ? isNull(table.recordKey) : eq(table.recordKey, request.recordKey),
          inArray(table.state, [...ACTIVE_OCCURRENCE]),
        ),
      )
      .get()
    const at = Date.now()
    const values = {
      id: randomUUID(),
      triggerId: row.id,
      recordKey: request.recordKey,
      generation: row.generation,
      kind: request.kind,
      dueAt: request.dueAt ?? null,
      requestKey: request.requestKey,
      payloadFingerprint: fingerprint,
      payloadJson: JSON.stringify(payload),
      taskId: randomUUID(),
      runId: randomUUID(),
      state: active ? 'skipped' : request.blocked ? 'blocked' : 'claimed',
      detail: active ? `Skipped: previous run still active (${active.runId}).` : (request.blocked ?? null),
      createdAt: at,
      updatedAt: at,
    }
    tx.insert(table).values(values).run()
    return values
  }

  /** Takes an occurrence as far as it can go: its root task, then its run. Safe to call again after
   *  any failure, because each step reuses the reserved IDs. */
  async resume(initial: Occurrence): Promise<Occurrence> {
    let row = this.read(initial.id) ?? initial
    if (!isActive(row.state)) return row
    const trigger = this.deps.db
      .select()
      .from(schema.workflowTriggers)
      .where(eq(schema.workflowTriggers.id, row.triggerId))
      .get()
    if (!trigger) throw new Error('Workflow trigger not found.')
    if (trigger.generation !== row.generation || ['deleted', 'needs-review'].includes(trigger.state)) {
      this.block(row.id, 'Trigger approval changed before dispatch.')
      throw new ScheduleSkipped('trigger approval changed before dispatch')
    }
    const payload = JSON.parse(row.payloadJson) as WorkflowTriggerPayload
    if (row.state === 'claimed') {
      // Recheck project trust, source capability, connections, and the reviewed graph before the
      // first core effect. A passing failure leaves this exact intent for the scheduler to retry.
      if (!(await this.authorized(trigger, row, () => this.deps.stillApproved(trigger, payload)))) {
        this.deps.moveToReview(trigger.id, 'Published workflow dependencies changed before dispatch.')
        this.block(row.id, 'Approval changed before dispatch.')
        throw new ScheduleSkipped('workflow approval changed — review to resume')
      }
      // Core refuses to replay an intended task with a different seed, so a clock's stays as it was.
      await this.deps.tasks.createRoot(
        trigger.projectId,
        {
          title: `${payload.graph.root.name} · ${payload.record?.title ?? 'scheduled'}`,
          branch: `workflow-${row.id.slice(0, 8)}`,
          origin: payload.record ? 'workflows:trigger' : 'workflows:schedule',
        },
        row.taskId,
      )
      row = this.advance(row.id, 'claimed', 'task-created')
    }
    if (row.state === 'task-created') {
      await this.authorized(trigger, row, () =>
        this.deps.starts.startTriggered({
          triggerId: trigger.id,
          taskId: row.taskId,
          graph: payload.graph,
          intendedRunId: row.runId,
          // The `schedule:` prefix stays so a start recorded before the rename replays as itself.
          callerKey: `schedule:${trigger.id}:occurrence:${row.id}`,
          payloadFingerprint: row.payloadFingerprint,
          inputs: payload.inputs,
          processingScope: { scopeId: trigger.id, epoch: trigger.epoch },
          baseline: payload.baseline,
        }),
      )
      row = this.advance(row.id, 'task-created', 'run-started')
    }
    return row
  }

  /** Marks an occurrence terminal once its root and every descendant have settled. The root owns the
   *  trigger's overlap until then, even when a runner settles the root first. */
  async settleRun(runId: string): Promise<void> {
    const table = schema.workflowTriggerOccurrences
    const occurrence = this.deps.db.select().from(table).where(eq(table.runId, runId)).get()
    if (!occurrence) return
    const run = this.deps.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).get()
    if (!run || ACTIVE_RUN.includes(run.status as (typeof ACTIVE_RUN)[number])) return
    const activeDescendant = this.deps.db
      .select({ id: schema.workflowRuns.id })
      .from(schema.workflowRuns)
      .where(and(eq(schema.workflowRuns.rootRunId, runId), inArray(schema.workflowRuns.status, [...ACTIVE_RUN])))
      .get()
    if (activeDescendant) return
    this.deps.db
      .update(table)
      .set({ state: 'terminal', detail: run.error, updatedAt: Date.now() })
      .where(eq(table.id, occurrence.id))
      .run()
    await this.deps.settled(occurrence, run)
  }

  /** Finishes what a restart interrupted: settles started runs and resumes the rest. */
  async reconcile(triggerId?: string): Promise<void> {
    const table = schema.workflowTriggerOccurrences
    const active = inArray(table.state, [...ACTIVE_OCCURRENCE])
    const rows = this.deps.db
      .select()
      .from(table)
      .where(triggerId ? and(eq(table.triggerId, triggerId), active) : active)
      .all()
    for (const row of rows) {
      if (row.state === 'run-started') await this.settleRun(row.runId)
      else await this.resume(row)
    }
  }

  active(triggerId: string): Occurrence | null {
    const table = schema.workflowTriggerOccurrences
    return (
      this.deps.db
        .select()
        .from(table)
        .where(and(eq(table.triggerId, triggerId), inArray(table.state, [...ACTIVE_OCCURRENCE])))
        .get() ?? null
    )
  }

  /** Runs one admission step. A refusal only the owner can fix moves the trigger to review and blocks
   *  this occurrence. Any other failure is left for the scheduler to retry. */
  private async authorized<T>(trigger: Trigger, row: Occurrence, step: () => Promise<T>): Promise<T> {
    try {
      return await step()
    } catch (error) {
      if (!(error instanceof WorkflowAuthorityError)) throw error
      this.deps.moveToReview(trigger.id, error.message, error.reason)
      this.block(row.id, error.message)
      throw new ScheduleSkipped(error.message)
    }
  }

  private block(id: string, detail: string): void {
    this.deps.db
      .update(schema.workflowTriggerOccurrences)
      .set({ state: 'blocked', detail, updatedAt: Date.now() })
      .where(eq(schema.workflowTriggerOccurrences.id, id))
      .run()
  }

  private advance(id: string, from: string, to: string): Occurrence {
    const table = schema.workflowTriggerOccurrences
    this.deps.db
      .update(table)
      .set({ state: to, detail: null, updatedAt: Date.now() })
      .where(and(eq(table.id, id), eq(table.state, from)))
      .run()
    return this.read(id)!
  }

  private read(id: string): Occurrence | undefined {
    const table = schema.workflowTriggerOccurrences
    return this.deps.db.select().from(table).where(eq(table.id, id)).get()
  }
}
