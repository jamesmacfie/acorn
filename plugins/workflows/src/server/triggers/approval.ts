// Approval: what the owner agreed a trigger may start. It resolves the published workflow for the
// trigger's project, freezes its graph, inputs, and limits, lists what changed since the last
// approval, and moves a trigger to Needs review when that approval no longer holds.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph, WorkflowAuthorityReason } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'
import type {
  WorkflowTriggerFirstCheck,
  WorkflowTriggerLimits,
  WorkflowTriggerLoop,
  WorkflowTriggerLoopSetting,
  WorkflowTriggerPayload,
  WorkflowTriggerWhen,
} from '../../shared/workflowTriggers'
import type { WorkflowStartService } from '../runs/admission'
import type { WorkflowResolutionScope } from '../definitions/resolution'
import { asAuthorityError } from '../runs/authority'
import { applyTriggerLoopSettings, describeTriggerLoops, type TriggerSourceDescriber } from './clock'
import { applyTriggerLimits } from './limits'

type Trigger = typeof schema.workflowTriggers.$inferSelect

export type TriggerResolver = {
  starts: Pick<WorkflowStartService, 'prepareTriggered'>
  describeSource?: TriggerSourceDescriber
}

const pathKey = (path: readonly string[]): string => JSON.stringify(path)

/** The workflow's input defaults, overlaid with what the owner supplied. */
const frozenInputs = (
  graph: ResolvedWorkflowGraph,
  supplied: Record<string, DataValue>,
): Record<string, DataValue> => ({
  ...Object.fromEntries(
    (graph.root.inputs ?? []).flatMap((input) => (input.default === undefined ? [] : [[input.name, input.default]])),
  ),
  ...supplied,
})

/** The published workflow as the trigger would run it now, with its loop settings applied. `deferred`
 *  names the inputs a record trigger fills from each record. A refusal only the owner can fix throws
 *  WorkflowAuthorityError. */
export async function resolveTriggerGraph(
  resolver: TriggerResolver,
  target: { projectId: string; workflowId: string },
  inputs: Record<string, DataValue>,
  loops: readonly WorkflowTriggerLoopSetting[],
  deferred: readonly string[] = [],
): Promise<{ graph: ResolvedWorkflowGraph; scope: WorkflowResolutionScope; loops: WorkflowTriggerLoop[] }> {
  try {
    const prepared = await resolver.starts.prepareTriggered(target.projectId, target.workflowId, inputs, deferred)
    const available = resolver.describeSource
      ? await describeTriggerLoops(
          prepared.graph,
          prepared.scope,
          frozenInputs(prepared.graph, inputs),
          resolver.describeSource,
          loops,
        )
      : []
    const graph = available.length ? applyTriggerLoopSettings(prepared.graph, available, loops) : prepared.graph
    return { graph, scope: prepared.scope, loops: available }
  } catch (error) {
    throw asAuthorityError(error)
  }
}

/** Records the owner's approval: the graph with its limits, the frozen inputs, and a new generation, so
 *  an occurrence reserved under the old approval can't start. `freshEpoch` forgets record history. A
 *  record trigger keeps only the values the owner gave, because the graph already holds the defaults
 *  and a default mustn't hide what the record fills. `approvedQuery` is a record trigger's pinned query. */
export function freezeApproval(
  db: PluginDatabase,
  row: Trigger,
  approved: {
    graph: ResolvedWorkflowGraph
    scope: WorkflowResolutionScope
    limits: WorkflowTriggerLimits
    approvedQuery?: unknown
  },
  requestedInputs: Record<string, DataValue>,
  firstCheck: WorkflowTriggerFirstCheck,
  freshEpoch: boolean,
): void {
  const graph = applyTriggerLimits(approved.graph, approved.limits)
  const records = approved.approvedQuery !== undefined
  db.update(schema.workflowTriggers)
    .set({
      workspaceId: approved.scope.workspaceId,
      inputsJson: JSON.stringify(records ? requestedInputs : frozenInputs(graph, requestedInputs)),
      approvedQueryJson: records ? JSON.stringify(approved.approvedQuery) : null,
      ...(freshEpoch ? { boundaryJson: null, queryFingerprint: null } : {}),
      limitsJson: JSON.stringify(approved.limits),
      approvedGraphJson: JSON.stringify(graph),
      approvedGraphDigest: graph.fingerprint,
      generation: row.generation + 1,
      epoch: freshEpoch ? randomUUID() : row.epoch,
      state: firstCheck === 'track-now' ? 'baselining' : 'active',
      firstCheck,
      error: null,
      errorReason: null,
      updatedAt: Date.now(),
    })
    .where(eq(schema.workflowTriggers.id, row.id))
    .run()
}

/** Whether the workflow the trigger would start now is still the one the owner approved. Recheck
 *  before an occurrence's first effect, because publication, connections, and trust can all move. */
export async function stillApproved(
  resolver: TriggerResolver,
  row: Trigger,
  loops: readonly WorkflowTriggerLoopSetting[],
  payload: WorkflowTriggerPayload,
): Promise<boolean> {
  const when = JSON.parse(row.whenJson) as WorkflowTriggerWhen
  // A record trigger's runs differ only in what each record fills, so the owner's values are what
  // approval resolved.
  const inputs = when.kind === 'records' ? (JSON.parse(row.inputsJson) as Record<string, DataValue>) : payload.inputs
  const deferred = when.kind === 'records' ? (await import('./records')).recordFilledInputs(when, inputs) : []
  const current = await resolveTriggerGraph(resolver, row, inputs, loops, deferred)
  return applyTriggerLimits(current.graph, payload.limits).fingerprint === row.approvedGraphDigest
}

export function moveToReview(
  db: PluginDatabase,
  id: string,
  error: string,
  reason: WorkflowAuthorityReason | null = null,
): void {
  db.update(schema.workflowTriggers)
    .set({ state: 'needs-review', error, errorReason: reason, updatedAt: Date.now() })
    .where(eq(schema.workflowTriggers.id, id))
    .run()
}

/** After a publication completes: every approved trigger whose frozen graph uses a changed workflow or
 *  saved query waits for the owner. Its approved snapshot stays, so the review can show what moved. */
export function reviewTriggersAfterPublication(
  db: PluginDatabase,
  changedWorkflows: ReadonlySet<string>,
  changedQueries: ReadonlySet<string>,
): void {
  for (const row of db.select().from(schema.workflowTriggers).all()) {
    if (!row.approvedGraphJson || row.state === 'deleted') continue
    const graph = JSON.parse(row.approvedGraphJson) as ResolvedWorkflowGraph
    const affectedWorkflow = graph.nodes.some(
      (node) => node.provenance.source === 'database' && changedWorkflows.has(node.provenance.id),
    )
    const when = JSON.parse(row.whenJson) as WorkflowTriggerWhen
    const affectedQuery =
      (when.kind === 'records' && when.query.kind === 'saved' && changedQueries.has(when.query.queryId)) ||
      graph.nodes.some((node) =>
        node.definition.steps.some((step) => step.query?.kind === 'saved' && changedQueries.has(step.query.queryId)),
      )
    if (!affectedWorkflow && !affectedQuery) continue
    moveToReview(
      db,
      row.id,
      affectedQuery
        ? 'A published shared query changed. Review this schedule before it runs again.'
        : 'A published workflow dependency changed. Review this schedule before it runs again.',
    )
  }
}

export function triggerChanges(
  approved: ResolvedWorkflowGraph | null,
  current: ResolvedWorkflowGraph,
): Array<{ kind: 'workflow' | 'query' | 'field'; label: string }> {
  if (!approved) return []
  const previous = new Map(approved.nodes.map((node) => [pathKey(node.path), node]))
  const changes: Array<{ kind: 'workflow' | 'query' | 'field'; label: string }> = []
  for (const node of current.nodes) {
    const prior = previous.get(pathKey(node.path))
    if (!prior || prior.fingerprint !== node.fingerprint)
      changes.push({ kind: 'workflow', label: node.definition.name })
    const priorSteps = new Map(prior?.definition.steps.map((step) => [stepIdentity(step), step]) ?? [])
    for (const step of node.definition.steps) {
      const priorStep = priorSteps.get(stepIdentity(step))
      if (step.kind === 'find-records' && JSON.stringify(step.query) !== JSON.stringify(priorStep?.query)) {
        changes.push({ kind: 'query', label: step.name })
      }
      if (
        step.kind === 'workflow-map' &&
        JSON.stringify(step.repeat ?? { mode: 'every-match' }) !==
          JSON.stringify(priorStep?.repeat ?? { mode: 'every-match' })
      ) {
        changes.push({ kind: 'field', label: step.name })
      }
    }
  }
  return changes.filter(
    (change, index) =>
      changes.findIndex((candidate) => candidate.kind === change.kind && candidate.label === change.label) === index,
  )
}
