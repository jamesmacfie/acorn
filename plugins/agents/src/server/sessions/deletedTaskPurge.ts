import { and, inArray, isNotNull, or } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { ManagedAgentEngine } from './runtimeEngine'

// Everything this plugin holds for deleted tasks (docs/workspaces-and-tasks/archive.md § Deleting a
// task). ManagedAgentRuntime.purgeDeletedTasks loads it on first use.

export type DeletedTaskPurgeDeps = {
  engine: Pick<ManagedAgentEngine, 'isStopped' | 'liveSessionIds' | 'revokeSessionCredential'>
  frames: ManagedAgentEngine['frames']
  store: ManagedAgentEngine['store']
  attachments: ManagedAgentEngine['attachments']
  artifacts: ManagedAgentEngine['artifacts']
  db: PluginDatabase
  // Events per step, the history prune's own step (runtime.ts § removeArchivedHistory).
  batch: number
  // Passed in rather than imported, so loading this module does not split ./ledgerCompaction.ts out
  // of the boot chunk it shares with the runtime.
  mergeSearchIndex: (db: PluginDatabase, pages: undefined, signal?: AbortSignal) => Promise<void>
}

/**
 * Deletes each session's events a batch at a time, as the history prune does, with a turn for the
 * event loop between steps, then the session and what it owns. Then the tasks' attachments, spawn rows
 * and webhooks. A session with a provider process or a turn in flight is left for the daily run.
 * Idempotent, and stops early on the signal. Answers how many rows went.
 */
export async function purgeDeletedTasks(
  deps: DeletedTaskPurgeDeps,
  taskIds: readonly string[],
  signal?: AbortSignal,
): Promise<number> {
  const { engine, store } = deps
  let events = 0
  const sessionIds: string[] = []
  const stopped = () => engine.isStopped || !!signal?.aborted
  while (!stopped()) {
    const sessionId = store.idleSessionOfTasks(taskIds, new Set(engine.liveSessionIds()))
    if (!sessionId) break
    const deleted = store.deleteOldestEvents(sessionId, deps.batch)
    events += deleted
    if (deleted < deps.batch) {
      const session = await store.getSession(sessionId)
      const removed = await store.deleteSession(sessionId)
      if (session) engine.revokeSessionCredential(session)
      sessionIds.push(sessionId)
      await Promise.all([
        deps.attachments.collectNow(removed.attachmentIds),
        deps.artifacts.collectRemoved(removed.artifactObjects),
      ])
      deps.frames.emit({ channel: 'agent:deleted', sessionId })
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  let rows = events + sessionIds.length
  if (!stopped()) rows += deleteTaskLedgers(deps.db, taskIds, sessionIds) + (await deleteTaskAttachments(deps, taskIds))
  // Each deleted event left a tombstone in the search index (./ledgerCompaction.ts).
  if (events && !engine.isStopped) await deps.mergeSearchIndex(deps.db, undefined, signal)
  return rows
}

// What deleted tasks leave apart from their sessions, in one transaction: the spawn rows naming them,
// their webhooks and those webhooks' deliveries, and the idempotency records of `sessionIds`, the
// sessions just deleted.
function deleteTaskLedgers(db: PluginDatabase, taskIds: readonly string[], sessionIds: readonly string[]): number {
  const ids = [...taskIds]
  return db.transaction((tx) => {
    const webhooks = tx
      .select({ id: schema.agentWebhooks.id })
      .from(schema.agentWebhooks)
      .where(inArray(schema.agentWebhooks.taskId, ids))
    return [
      tx
        .delete(schema.agentSpawns)
        .where(
          or(
            inArray(schema.agentSpawns.rootTaskId, ids),
            inArray(schema.agentSpawns.ownerTaskId, ids),
            inArray(schema.agentSpawns.childTaskId, ids),
          ),
        )
        .run(),
      tx.delete(schema.agentWebhookDeliveries).where(inArray(schema.agentWebhookDeliveries.webhookId, webhooks)).run(),
      tx.delete(schema.agentWebhooks).where(inArray(schema.agentWebhooks.taskId, ids)).run(),
      sessionIds.length
        ? tx
            .delete(schema.agentOperations)
            .where(inArray(schema.agentOperations.resourceId, [...sessionIds]))
            .run()
        : { changes: 0 },
    ].reduce((count, result) => count + Number(result.changes), 0)
  })
}

// The tasks' attachments, after their sessions. collectNow retires each one no turn claims and removes
// its file when no live row shares it, then the retired rows go. A row still claimed belongs to a
// session left for a later run, and stays.
async function deleteTaskAttachments(deps: DeletedTaskPurgeDeps, taskIds: readonly string[]): Promise<number> {
  const forTasks = inArray(schema.agentAttachments.taskId, [...taskIds])
  const rows = deps.db.select({ id: schema.agentAttachments.id }).from(schema.agentAttachments).where(forTasks).all()
  await deps.attachments.collectNow(rows.map((row) => row.id))
  return deps.db
    .delete(schema.agentAttachments)
    .where(and(forTasks, isNotNull(schema.agentAttachments.deletedAt)))
    .run().changes
}
