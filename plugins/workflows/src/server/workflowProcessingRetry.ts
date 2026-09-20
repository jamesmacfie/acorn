import { eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import { processingAttemptActive } from './workflowProcessingReadModel'

/** Claim the retained attempt before asynchronous retry effects can admit competing work. */
export function claimWorkflowRecordRetry(db: PluginDatabase, runId: string): void {
  db.transaction(tx => {
    const dispatch = tx.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.runId, runId)).get()
    if (!dispatch) return
    const attempt = tx.select().from(schema.workflowRecordAttempts).where(eq(schema.workflowRecordAttempts.dispatchId, dispatch.id)).get()
    if (!attempt) return
    const state = tx.select().from(schema.workflowRecordStates).where(eq(schema.workflowRecordStates.id, attempt.stateId)).get()
    if (!state || state.attemptId !== attempt.id) throw new Error('A later attempt exists. Retry the latest failed attempt or explicitly reprocess this record.')
    if (processingAttemptActive(tx, attempt.id)) throw new Error('This record attempt is already active')
    tx.update(schema.workflowRuns).set({ status: 'running', error: null, updatedAt: Date.now() }).where(eq(schema.workflowRuns.id, runId)).run()
  })
}
