import { desc, eq, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { ScheduleRow } from '@acorn/protocol/schedules.ts'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph, WorkflowAuthorityReason } from '../../shared/workflowContracts'
import type {
  WorkflowTriggerCheck,
  WorkflowTriggerFirstCheck,
  WorkflowTriggerLoopSetting,
  WorkflowTriggerState,
  WorkflowTriggerView,
  WorkflowTriggerWhen,
} from '../../shared/workflowTriggers'
import { DEFAULT_TRIGGER_WALL_TIME_MS, effectiveTriggerLimits } from './limits'
import { ACTIVE_OCCURRENCE, type Trigger } from './occurrences'

/** Refusals the owner fixes outside the trigger, by reconnecting an account or restoring what's gone. */
const UNAVAILABLE: ReadonlySet<WorkflowAuthorityReason | null> = new Set([
  'connection-required',
  'input-required',
  'missing',
])

export async function workflowTriggerView(
  db: PluginDatabase,
  row: Trigger,
  scheduler?: { list(): Promise<ScheduleRow[]> },
): Promise<WorkflowTriggerView> {
  const scheduled = row.schedulerKey
    ? (await scheduler?.list())?.find((entry) => entry.key === row.schedulerKey)
    : undefined
  // Each occurrence carries the workflow's whole graph, so read only the last. The row ID settles a tie.
  const occurrence = db
    .select()
    .from(schema.workflowTriggerOccurrences)
    .where(eq(schema.workflowTriggerOccurrences.triggerId, row.id))
    .orderBy(desc(schema.workflowTriggerOccurrences.updatedAt), desc(sql`rowid`))
    .limit(1)
    .get()
  const internal = row.state as WorkflowTriggerState
  const unavailable = !!row.schedulerKey && (!scheduled?.registered || UNAVAILABLE.has(row.errorReason))
  const displayState: WorkflowTriggerView['state'] = unavailable
    ? 'unavailable'
    : internal === 'active' && scheduled?.enabled === false
      ? 'paused'
      : internal === 'active'
        ? 'active'
        : internal === 'baselining'
          ? 'activating'
          : internal === 'draft' && !row.approvedGraphJson
            ? 'draft'
            : 'needs-review'
  const approved = row.approvedGraphJson ? (JSON.parse(row.approvedGraphJson) as ResolvedWorkflowGraph) : null
  return {
    id: row.id,
    projectId: row.projectId,
    workflowId: row.workflowId,
    workflowName: approved?.root.name ?? scheduled?.name ?? 'Workflow trigger',
    inputs: JSON.parse(row.inputsJson),
    when: JSON.parse(row.whenJson) as WorkflowTriggerWhen,
    cadence: scheduled?.cadence ?? { daily: '09:00' },
    limits: approved
      ? effectiveTriggerLimits(approved, JSON.parse(row.limitsJson))
      : {
          maxDescendants: 100,
          maxConcurrency: 4,
          budget: { maxWallTimeMs: DEFAULT_TRIGGER_WALL_TIME_MS },
        },
    loops: JSON.parse(row.loopsJson || '[]') as WorkflowTriggerLoopSetting[],
    firstCheck: row.firstCheck as WorkflowTriggerFirstCheck,
    state: displayState,
    ...(row.error ? { error: row.error } : {}),
    ...(scheduled?.nextRunAt && displayState === 'active' ? { nextRunAt: scheduled.nextRunAt } : {}),
    ...(occurrence
      ? {
          latest: {
            kind:
              occurrence.kind === 'baseline'
                ? 'baseline'
                : occurrence.kind === 'manual'
                  ? 'manual'
                  : occurrence.kind === 'record'
                    ? 'match'
                    : 'scheduled',
            state: ACTIVE_OCCURRENCE.includes(occurrence.state as (typeof ACTIVE_OCCURRENCE)[number])
              ? 'active'
              : occurrence.state === 'terminal'
                ? 'completed'
                : occurrence.state === 'skipped'
                  ? 'skipped'
                  : 'blocked',
            taskId: occurrence.taskId,
            runId: occurrence.runId,
            ...(occurrence.detail ? { detail: occurrence.detail } : {}),
            createdAt: occurrence.createdAt,
          },
        }
      : {}),
    ...(row.lastCheckJson ? { lastCheck: JSON.parse(row.lastCheckJson) as WorkflowTriggerCheck } : {}),
    updatedAt: row.updatedAt,
  }
}
