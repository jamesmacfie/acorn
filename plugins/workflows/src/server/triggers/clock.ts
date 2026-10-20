// The clock kind: a trigger the core scheduler fires on a cadence. It owns the settings for the
// workflow's For each loops, the Track from now baseline run, and one active occurrence per trigger
// (docs/workflows/triggers.md).
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { dataBindingSchema, type DataField } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { QueryReference, QueryScope } from '@acorn/protocol/dataQueries.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { resolveDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph, ResolvedWorkflowNode, WorkflowStepDef } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'
import type {
  WorkflowTriggerLoop,
  WorkflowTriggerLoopSetting,
  WorkflowTriggerWhen,
} from '../../shared/workflowTriggers'
import { processingFields } from '../processing/rules'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import { WorkflowAuthorityError } from '../runs/authority'
import type { Occurrence, OccurrenceRequest, Trigger, TriggerOccurrences } from './occurrences'

type TriggerSourceDescription = {
  label: string
  schema: DataSchema
  fields: DataField[]
  incremental: boolean
  incrementalReason?: string
}

export type TriggerSourceDescriber = (
  reference: QueryReference,
  scope: QueryScope,
  inputs: Record<string, DataValue>,
) => Promise<TriggerSourceDescription>

/** How the core scheduler asked for this occurrence. */
export type ClockContext = { reason: 'due' | 'manual' | 'catch-up'; dueAt?: number; requestKey?: string }

export function clockWhen(raw: unknown): WorkflowTriggerWhen | null {
  const when = raw as Partial<WorkflowTriggerWhen> | null
  if (when?.kind !== 'clock' || typeof when.timezone !== 'string') return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: when.timezone }).format()
    return { kind: 'clock', timezone: when.timezone }
  } catch {
    return null
  }
}

export const configuredLoops = (row: Trigger): WorkflowTriggerLoopSetting[] =>
  JSON.parse(row.loopsJson || '[]') as WorkflowTriggerLoopSetting[]

/** A due tick replays by its instant, so a catch-up after a restart reuses the occurrence it reserved.
 *  The record key is null: one occurrence runs at a time for the whole trigger. */
export function clockOccurrence(row: Trigger, context: ClockContext): OccurrenceRequest {
  if (context.reason !== 'manual' && context.dueAt === undefined)
    throw new Error('Scheduled occurrences require their persisted due instant.')
  return {
    kind: context.reason,
    dueAt: context.dueAt,
    requestKey:
      context.reason === 'manual'
        ? `manual:${context.requestKey ?? randomUUID()}`
        : `due:${row.generation}:${context.dueAt}`,
    recordKey: null,
  }
}

/** Track from now: one run that records today's matches without acting on them. The trigger stays
 *  `baselining` until that run settles, and becomes `baseline-failed` if it can't start. */
export async function startBaseline(db: PluginDatabase, occurrences: TriggerOccurrences, row: Trigger): Promise<void> {
  const occurrence = occurrences.reserve(row, {
    kind: 'baseline',
    requestKey: `baseline:${row.generation}`,
    recordKey: null,
  })
  try {
    await occurrences.resume(occurrence)
  } catch (error) {
    const current = db.select().from(schema.workflowTriggers).where(eq(schema.workflowTriggers.id, row.id)).get()
    if (current?.state !== 'needs-review') {
      db.update(schema.workflowTriggers)
        .set({
          state: 'baseline-failed',
          error: error instanceof Error ? error.message : 'Baseline check could not start.',
          errorReason: null,
          updatedAt: Date.now(),
        })
        .where(and(eq(schema.workflowTriggers.id, row.id), eq(schema.workflowTriggers.generation, row.generation)))
        .run()
    }
    throw error
  }
}

/** What a settled run tree means for a clock trigger. Returns true when a baseline finished and the
 *  trigger became active, so the caller turns its cadence on. */
export function settleClockRun(
  db: PluginDatabase,
  occurrence: Occurrence,
  run: typeof schema.workflowRuns.$inferSelect,
  moveToReview: (id: string, error: string) => void,
): boolean {
  if (occurrence.kind !== 'baseline') {
    if (run.status === 'failed' && run.errorCause === 'checkpoint-expired')
      moveToReview(occurrence.triggerId, run.error ?? 'Incremental continuation needs review.')
    return false
  }
  const ok = run.status === 'done' || run.status === 'completed-with-failures'
  db.update(schema.workflowTriggers)
    .set({
      state: ok ? 'active' : 'baseline-failed',
      error: ok ? null : (run.error ?? 'Baseline check failed.'),
      errorReason: null,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(schema.workflowTriggers.id, occurrence.triggerId),
        eq(schema.workflowTriggers.generation, occurrence.generation),
      ),
    )
    .run()
  return ok
}

type LoopTarget = {
  loopId: string
  node: ResolvedWorkflowNode
  loop: WorkflowStepDef
  source: WorkflowStepDef | undefined
  sourceConsumerCount: number
  inputs: Record<string, DataValue>
}

const pathKey = (path: readonly string[]): string => JSON.stringify(path)
const loopId = (node: ResolvedWorkflowNode, loop: WorkflowStepDef): string =>
  JSON.stringify([node.path, stepIdentity(loop)])

function nodeInputContexts(
  graph: ResolvedWorkflowGraph,
  rootInputs: Record<string, DataValue>,
): Map<string, Record<string, DataValue>> {
  const contexts = new Map<string, Record<string, DataValue>>()
  for (const node of graph.nodes) {
    const inputs = { ...node.defaultInputs, ...rootInputs }
    if (node.path.length > 1) {
      const parentPath = node.path.slice(0, -1)
      const parent = graph.nodes.find((candidate) => pathKey(candidate.path) === pathKey(parentPath))
      const parentInputs = contexts.get(pathKey(parentPath)) ?? rootInputs
      const parentStep = parent?.definition.steps.find((step) => stepIdentity(step) === node.path.at(-1))
      for (const [name, binding] of Object.entries(parentStep?.childWorkflow?.inputs ?? {})) {
        try {
          inputs[name] = resolveDataBinding(dataBindingSchema.parse(binding), { inputs: parentInputs })
        } catch {
          /* Record-bound child inputs have no value until an occurrence executes. */
        }
      }
    }
    contexts.set(pathKey(node.path), inputs)
  }
  return contexts
}

function targets(graph: ResolvedWorkflowGraph, rootInputs: Record<string, DataValue>): LoopTarget[] {
  const contexts = nodeInputContexts(graph, rootInputs)
  return graph.nodes.flatMap((node) =>
    node.definition.steps.flatMap((loop) => {
      if (loop.kind !== 'workflow-map') return []
      const sourceId = loop.items?.step
      const source = node.definition.steps.find((step) => stepIdentity(step) === sourceId)
      const sourceConsumerCount = node.definition.steps.filter(
        (step) => step.kind === 'workflow-map' && step.items?.step === sourceId,
      ).length
      return [
        {
          loopId: loopId(node, loop),
          node,
          loop,
          source,
          sourceConsumerCount,
          inputs: contexts.get(pathKey(node.path)) ?? rootInputs,
        },
      ]
    }),
  )
}

const recordSchema = (schema: DataSchema): DataSchema => ({
  type: 'object',
  properties: {
    ref: { type: 'object' },
    data: schema,
    display: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } },
  },
  required: ['ref', 'data'],
})

const prefixedFields = (fields: readonly DataField[]): DataField[] =>
  fields.map((field) => ({
    ...field,
    pointer: `/data${field.pointer}`,
  }))

export async function describeTriggerLoops(
  graph: ResolvedWorkflowGraph,
  scope: QueryScope,
  rootInputs: Record<string, DataValue>,
  describe: TriggerSourceDescriber,
  configured: readonly WorkflowTriggerLoopSetting[] = [],
): Promise<WorkflowTriggerLoop[]> {
  const settings = new Map(configured.map((setting) => [setting.loopId, setting]))
  const recordLoops = targets(graph, rootInputs).filter(
    (target) => target.source?.kind === 'find-records' && target.source.query,
  )
  return Promise.all(
    recordLoops.map(async (target) => {
      const current = settings.get(target.loopId) ?? {
        loopId: target.loopId,
        repeat: target.loop.repeat ?? { mode: 'every-match' as const },
        incremental: !!target.source?.incremental,
      }
      const source = await describe(target.source!.query!, scope, target.inputs)
      const checkpointAvailable = source.incremental && target.sourceConsumerCount === 1
      return {
        loopId: target.loopId,
        label: target.loop.name,
        sourceLabel: source.label,
        schema: recordSchema(source.schema),
        fields: prefixedFields(source.fields),
        checkpointAvailable,
        ...(!checkpointAvailable
          ? {
              checkpointReason:
                target.sourceConsumerCount > 1
                  ? 'This query feeds more than one loop, so it cannot have one unambiguous checkpoint.'
                  : (source.incrementalReason ??
                    'This source does not promise a safe continuation checkpoint. Use a rolling window instead.'),
            }
          : {}),
        setting: { ...current, incremental: checkpointAvailable && current.incremental },
      }
    }),
  )
}

export function applyTriggerLoopSettings(
  graph: ResolvedWorkflowGraph,
  available: readonly WorkflowTriggerLoop[],
  configured: readonly WorkflowTriggerLoopSetting[],
): ResolvedWorkflowGraph {
  const descriptors = new Map(available.map((loop) => [loop.loopId, loop]))
  const settings = new Map(
    configured.map((setting) => {
      const descriptor = descriptors.get(setting.loopId)
      if (!descriptor)
        throw new WorkflowAuthorityError(
          'missing',
          'A configured record loop no longer exists in the published workflow.',
        )
      const fields = processingFields(setting.repeat)
      const availableFields = new Set(descriptor.fields.map((field) => field.pointer))
      if (fields.some((field) => !availableFields.has(field)))
        throw new WorkflowAuthorityError('missing', 'A tracked field is no longer available from this record source.')
      if (setting.incremental && !descriptor.checkpointAvailable)
        throw new Error(descriptor.checkpointReason ?? 'That source cannot use a continuation checkpoint.')
      return [setting.loopId, setting]
    }),
  )
  const nodes = graph.nodes.map((node) => {
    const nodeTargets = targets({ ...graph, nodes: [node] }, {}).map((target) => [target.loopId, target] as const)
    const bySource = new Map<string, boolean>()
    const steps = node.definition.steps
      .map((step) => {
        const target = nodeTargets.find(([, candidate]) => stepIdentity(candidate.loop) === stepIdentity(step))
        if (!target) return step
        const setting = settings.get(target[0]) ?? descriptors.get(target[0])?.setting
        if (!setting) return step
        if (target[1].source) bySource.set(stepIdentity(target[1].source), setting.incremental)
        return { ...step, repeat: setting.repeat }
      })
      .map((step) =>
        bySource.has(stepIdentity(step)) ? { ...step, incremental: bySource.get(stepIdentity(step)) } : step,
      )
    return { ...node, definition: { ...node.definition, steps } }
  })
  const root = nodes[0]?.definition ?? graph.root
  const fingerprint = workflowContentFingerprint(
    nodes.map(({ path, definition, provenance, defaultInputs }) => ({ path, definition, provenance, defaultInputs })),
  )
  return { ...graph, root, nodes, fingerprint }
}
