import { dataBindingSchema, type DataField } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { QueryReference, QueryScope } from '@acorn/protocol/dataQueries.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { resolveDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import type { ResolvedWorkflowGraph, ResolvedWorkflowNode, WorkflowBudget, WorkflowStepDef } from '../shared/workflowContracts'
import { stepIdentity } from '../shared/workflowIdentity'
import type { WorkflowScheduleDraftInput, WorkflowScheduleLimits, WorkflowScheduleLoop, WorkflowScheduleLoopSetting } from '../shared/workflowSchedules'
import { processingFields } from './workflowProcessingRules'
import { workflowContentFingerprint } from './workflowResolution'

export type ScheduleSourceDescription = {
  label: string
  schema: DataSchema
  fields: DataField[]
  incremental: boolean
  incrementalReason?: string
}

export type ScheduleSourceDescriber = (
  reference: QueryReference,
  scope: QueryScope,
  inputs: Record<string, DataValue>,
) => Promise<ScheduleSourceDescription>

export const DEFAULT_SCHEDULE_WALL_TIME_MS = 24 * 60 * 60 * 1000

export function effectiveScheduleLimits(graph: ResolvedWorkflowGraph, requested?: WorkflowScheduleDraftInput['limits']): WorkflowScheduleLimits {
  const root = graph.root
  const maxDescendants = requested?.maxDescendants ?? root.maxDescendants ?? 100
  const maxConcurrency = requested?.maxConcurrency ?? root.maxConcurrency ?? 4
  const requestedBudget: WorkflowBudget = requested?.budget ?? {}
  const maxWallTimeMs = requestedBudget.maxWallTimeMs ?? root.budget?.maxWallTimeMs ?? DEFAULT_SCHEDULE_WALL_TIME_MS
  if (!Number.isSafeInteger(maxDescendants) || maxDescendants < 1 || maxDescendants > Math.min(root.maxDescendants ?? 500, 500)) {
    throw new Error('Scheduled max descendants must be from 1 to the workflow ceiling.')
  }
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > Math.min(root.maxConcurrency ?? 4, 4)) {
    throw new Error('Scheduled concurrency must be from 1 to the workflow ceiling.')
  }
  if (!Number.isFinite(maxWallTimeMs) || maxWallTimeMs <= 0
    || (root.budget?.maxWallTimeMs != null && maxWallTimeMs > root.budget.maxWallTimeMs)) {
    throw new Error('Scheduled wall time must be finite and no wider than the workflow budget.')
  }
  for (const field of ['maxCostUsd', 'maxInputTokens', 'maxOutputTokens', 'maxTurns'] as const) {
    const value = requestedBudget[field]
    const ceiling = root.budget?.[field]
    if (value != null && (!Number.isFinite(value) || value < 0 || (ceiling != null && value > ceiling))) {
      throw new Error(`Scheduled ${field} must be finite and no wider than the workflow budget.`)
    }
  }
  return { maxDescendants, maxConcurrency, budget: { ...root.budget, ...requestedBudget, maxWallTimeMs } }
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

function nodeInputContexts(graph: ResolvedWorkflowGraph, rootInputs: Record<string, DataValue>): Map<string, Record<string, DataValue>> {
  const contexts = new Map<string, Record<string, DataValue>>()
  for (const node of graph.nodes) {
    const inputs = { ...node.defaultInputs, ...rootInputs }
    if (node.path.length > 1) {
      const parentPath = node.path.slice(0, -1)
      const parent = graph.nodes.find(candidate => pathKey(candidate.path) === pathKey(parentPath))
      const parentInputs = contexts.get(pathKey(parentPath)) ?? rootInputs
      const parentStep = parent?.definition.steps.find(step => stepIdentity(step) === node.path.at(-1))
      for (const [name, binding] of Object.entries(parentStep?.childWorkflow?.inputs ?? {})) {
        try {
          inputs[name] = resolveDataBinding(dataBindingSchema.parse(binding), { inputs: parentInputs })
        } catch { /* Record-bound child inputs have no value until an occurrence executes. */ }
      }
    }
    contexts.set(pathKey(node.path), inputs)
  }
  return contexts
}

function targets(graph: ResolvedWorkflowGraph, rootInputs: Record<string, DataValue>): LoopTarget[] {
  const contexts = nodeInputContexts(graph, rootInputs)
  return graph.nodes.flatMap(node => node.definition.steps.flatMap(loop => {
    if (loop.kind !== 'workflow-map') return []
    const sourceId = loop.items?.step
    const source = node.definition.steps.find(step => stepIdentity(step) === sourceId)
    const sourceConsumerCount = node.definition.steps.filter(step => step.kind === 'workflow-map' && step.items?.step === sourceId).length
    return [{ loopId: loopId(node, loop), node, loop, source, sourceConsumerCount, inputs: contexts.get(pathKey(node.path)) ?? rootInputs }]
  }))
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

const prefixedFields = (fields: readonly DataField[]): DataField[] => fields.map(field => ({
  ...field,
  pointer: `/data${field.pointer}`,
}))

export async function describeScheduleLoops(
  graph: ResolvedWorkflowGraph,
  scope: QueryScope,
  rootInputs: Record<string, DataValue>,
  describe: ScheduleSourceDescriber,
  configured: readonly WorkflowScheduleLoopSetting[] = [],
): Promise<WorkflowScheduleLoop[]> {
  const settings = new Map(configured.map(setting => [setting.loopId, setting]))
  const recordLoops = targets(graph, rootInputs).filter(target => target.source?.kind === 'find-records' && target.source.query)
  return Promise.all(recordLoops.map(async target => {
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
      ...(!checkpointAvailable ? {
        checkpointReason: target.sourceConsumerCount > 1
          ? 'This query feeds more than one loop, so it cannot have one unambiguous checkpoint.'
          : source.incrementalReason ?? 'This source does not promise a safe continuation checkpoint. Use a rolling window instead.',
      } : {}),
      setting: { ...current, incremental: checkpointAvailable && current.incremental },
    }
  }))
}

export function applyScheduleLoopSettings(
  graph: ResolvedWorkflowGraph,
  available: readonly WorkflowScheduleLoop[],
  configured: readonly WorkflowScheduleLoopSetting[],
): ResolvedWorkflowGraph {
  const descriptors = new Map(available.map(loop => [loop.loopId, loop]))
  const settings = new Map(configured.map(setting => {
    const descriptor = descriptors.get(setting.loopId)
    if (!descriptor) throw new Error('A configured record loop no longer exists in the published workflow.')
    const fields = processingFields(setting.repeat)
    const availableFields = new Set(descriptor.fields.map(field => field.pointer))
    if (fields.some(field => !availableFields.has(field))) throw new Error('A tracked field is no longer available from this record source.')
    if (setting.incremental && !descriptor.checkpointAvailable) throw new Error(descriptor.checkpointReason ?? 'That source cannot use a continuation checkpoint.')
    return [setting.loopId, setting]
  }))
  const nodes = graph.nodes.map(node => {
    const nodeTargets = targets({ ...graph, nodes: [node] }, {}).map(target => [target.loopId, target] as const)
    const bySource = new Map<string, boolean>()
    const steps = node.definition.steps.map(step => {
      const target = nodeTargets.find(([, candidate]) => stepIdentity(candidate.loop) === stepIdentity(step))
      if (!target) return step
      const setting = settings.get(target[0]) ?? descriptors.get(target[0])?.setting
      if (!setting) return step
      if (target[1].source) bySource.set(stepIdentity(target[1].source), setting.incremental)
      return { ...step, repeat: setting.repeat }
    }).map(step => bySource.has(stepIdentity(step)) ? { ...step, incremental: bySource.get(stepIdentity(step)) } : step)
    return { ...node, definition: { ...node.definition, steps } }
  })
  const root = nodes[0]?.definition ?? graph.root
  const fingerprint = workflowContentFingerprint(nodes.map(({ path, definition, provenance, defaultInputs }) => ({ path, definition, provenance, defaultInputs })))
  return { ...graph, root, nodes, fingerprint }
}

export function scheduleChanges(approved: ResolvedWorkflowGraph | null, current: ResolvedWorkflowGraph): Array<{ kind: 'workflow' | 'query' | 'field'; label: string }> {
  if (!approved) return []
  const previous = new Map(approved.nodes.map(node => [pathKey(node.path), node]))
  const changes: Array<{ kind: 'workflow' | 'query' | 'field'; label: string }> = []
  for (const node of current.nodes) {
    const prior = previous.get(pathKey(node.path))
    if (!prior || prior.fingerprint !== node.fingerprint) changes.push({ kind: 'workflow', label: node.definition.name })
    const priorSteps = new Map(prior?.definition.steps.map(step => [stepIdentity(step), step]) ?? [])
    for (const step of node.definition.steps) {
      const priorStep = priorSteps.get(stepIdentity(step))
      if (step.kind === 'find-records' && JSON.stringify(step.query) !== JSON.stringify(priorStep?.query)) {
        changes.push({ kind: 'query', label: step.name })
      }
      if (step.kind === 'workflow-map' && JSON.stringify(step.repeat ?? { mode: 'every-match' }) !== JSON.stringify(priorStep?.repeat ?? { mode: 'every-match' })) {
        changes.push({ kind: 'field', label: step.name })
      }
    }
  }
  return changes.filter((change, index) => changes.findIndex(candidate => candidate.kind === change.kind && candidate.label === change.label) === index)
}
