import { and, desc, eq, inArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { NotesStoreCapability } from '@acorn/plugin-notes/contract/store.ts'
import type { WorkflowReviewInputCapability } from '../contract/reviewInput'
import { workflowRuns } from '../node/schema'

const TERMINAL_STATUSES = ['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled']

function leadingUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  let end = Math.min(bytes.length, maxBytes)
  while (end < bytes.length && end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

export function workflowReviewInput(
  db: PluginDatabase,
  notes: () => NotesStoreCapability | undefined,
): WorkflowReviewInputCapability {
  return {
    listCompleted: async (taskId) => db.select({ taskId: workflowRuns.taskId, runId: workflowRuns.id,
      status: workflowRuns.status, completedAt: workflowRuns.updatedAt })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.taskId, taskId), inArray(workflowRuns.status, TERMINAL_STATUSES)))
      .orderBy(desc(workflowRuns.updatedAt)).limit(256),
    read: async (taskId, runId) => {
      const [run] = await db.select({ taskId: workflowRuns.taskId, status: workflowRuns.status,
        completedAt: workflowRuns.updatedAt }).from(workflowRuns)
        .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.taskId, taskId))).limit(1)
      const base = { taskId, runId, status: run?.status ?? 'unavailable', completedAt: run?.completedAt ?? 0 }
      if (!run || !TERMINAL_STATUSES.includes(run.status)) return {
        ...base, availability: 'unavailable' as const, handoff: null, unavailableReason: 'The workflow completion is unavailable.',
      }
      const note = await notes()?.read({ scope: 'task', taskId }, `workflow-handoffs-${runId}`).catch(() => null)
      const handoff = leadingUtf8(note?.body ?? '', 16_384) || null
      return {
        ...base, availability: handoff?.trim() ? 'available' as const : 'unavailable' as const, handoff,
        unavailableReason: handoff?.trim() ? null : 'The workflow produced no handoff note.',
      }
    },
  }
}
