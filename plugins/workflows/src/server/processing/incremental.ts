import { eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import type { WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
import * as schema from '../../node/schema'
import { stepIdentity } from '../../shared/workflowIdentity'
import { workflowProcessingScopeKey } from './store'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import { workflowAncestors, workflowEdges } from '../validation/definition'

export function incrementalConsumer(def: WorkflowDef, query: WorkflowStepDef): WorkflowStepDef {
  const consumers = def.steps.filter(step => step.items?.step === stepIdentity(query))
  if (consumers.length !== 1 || consumers[0].kind !== 'workflow-map' || !consumers[0].repeat || consumers[0].items?.pointer !== '/records') {
    throw new Error('An incremental query must feed exactly one tracked For each through its records array')
  }
  // Keep the path to the checkpoint consumer unconditional; later conditions do not affect its commit.
  const predecessors = workflowAncestors(workflowEdges(def.steps), stepIdentity(consumers[0]))
  if (!predecessors || def.steps.some(step => predecessors.has(stepIdentity(step)) && step.branches && Object.keys(step.branches).length)) throw new Error('An incremental query cannot use a branch that can skip its consuming loop')
  return consumers[0]
}

export function workflowIncrementalQuery(db: PluginDatabase, runId: string, queryStepId: string, query: DataSourceQuery): DataSourceQuery {
  if (query.take) throw new Error('Incremental queries cannot use take')
  const run = db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).get()
  const queryRow = db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, queryStepId)).get()
  if (!run || !queryRow || queryRow.runId !== run.id) throw new Error('Incremental query does not belong to the run')
  const def = JSON.parse(run.defJson) as WorkflowDef
  const consumer = incrementalConsumer(def, def.steps[queryRow.idx])
  const row = db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId)).all().find(row => row.idx === def.steps.indexOf(consumer))
  if (!row) throw new Error('Incremental consumer is missing')
  const scopeKey = workflowProcessingScopeKey(db, runId, row.id)
  const boundary = db.select().from(schema.workflowProcessingBoundaries).where(eq(schema.workflowProcessingBoundaries.scopeKey, scopeKey)).get()
  const { incremental: _incremental, ...base } = query
  if (boundary && boundary.queryFingerprint !== workflowContentFingerprint(base)) throw new Error('Incremental query changed. Choose a fresh baseline or epoch.')
  return { ...base, incremental: boundary ? { kind: 'continue', boundary: JSON.parse(boundary.boundaryJson) } : { kind: 'baseline' } }
}
