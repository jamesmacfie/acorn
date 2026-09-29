import { eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { ScheduleRow } from '@acorn/protocol/schedules.ts'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph } from '../../shared/workflowContracts'
import type { WorkflowScheduleFirstCheck, WorkflowScheduleLoopSetting, WorkflowScheduleState, WorkflowScheduleView } from '../../shared/workflowSchedules'
import { DEFAULT_SCHEDULE_WALL_TIME_MS, effectiveScheduleLimits } from './model'

type Schedule = typeof schema.workflowSchedules.$inferSelect
const ACTIVE_OCCURRENCE = ['claimed', 'task-created', 'run-started'] as const

export async function workflowScheduleView(
  db: PluginDatabase,
  row: Schedule,
  scheduler?: { list(): Promise<ScheduleRow[]> },
): Promise<WorkflowScheduleView> {
  const scheduled = row.schedulerKey ? (await scheduler?.list())?.find(entry => entry.key === row.schedulerKey) : undefined
  const occurrence = db.select().from(schema.workflowScheduleOccurrences)
    .where(eq(schema.workflowScheduleOccurrences.scheduleId, row.id))
    .orderBy(schema.workflowScheduleOccurrences.updatedAt)
    .all().at(-1)
  const internal = row.state as WorkflowScheduleState
  const unavailable = !!row.schedulerKey && (!scheduled?.registered || /connection|required|unavailable|revoked|disabled|no longer exists/i.test(row.error ?? ''))
  const displayState: WorkflowScheduleView['state'] = unavailable ? 'unavailable'
    : internal === 'active' && scheduled?.enabled === false ? 'paused'
      : internal === 'active' ? 'active'
        : internal === 'baselining' ? 'activating'
          : internal === 'draft' && !row.approvedGraphJson ? 'draft' : 'needs-review'
  const approved = row.approvedGraphJson ? JSON.parse(row.approvedGraphJson) as ResolvedWorkflowGraph : null
  return {
    id: row.id,
    projectId: row.projectId,
    workflowId: row.workflowId,
    workflowName: approved?.root.name ?? scheduled?.name ?? 'Scheduled workflow',
    inputs: JSON.parse(row.inputsJson),
    timezone: row.timezone,
    cadence: scheduled?.cadence ?? { daily: '09:00' },
    limits: approved ? effectiveScheduleLimits(approved, JSON.parse(row.limitsJson)) : {
      maxDescendants: 100, maxConcurrency: 4, budget: { maxWallTimeMs: DEFAULT_SCHEDULE_WALL_TIME_MS },
    },
    loops: JSON.parse(row.loopsJson || '[]') as WorkflowScheduleLoopSetting[],
    firstCheck: row.firstCheck as WorkflowScheduleFirstCheck,
    state: displayState,
    ...(row.error ? { error: row.error } : {}),
    ...(scheduled?.nextRunAt && displayState === 'active' ? { nextRunAt: scheduled.nextRunAt } : {}),
    ...(occurrence ? { latest: {
      kind: occurrence.kind === 'baseline' ? 'baseline' : occurrence.kind === 'manual' ? 'manual' : 'scheduled',
      state: ACTIVE_OCCURRENCE.includes(occurrence.state as typeof ACTIVE_OCCURRENCE[number]) ? 'active'
        : occurrence.state === 'terminal' ? 'completed' : occurrence.state === 'skipped' ? 'skipped' : 'blocked',
      taskId: occurrence.taskId,
      runId: occurrence.runId,
      ...(occurrence.detail ? { detail: occurrence.detail } : {}),
      createdAt: occurrence.createdAt,
    } } : {}),
    updatedAt: row.updatedAt,
  }
}
