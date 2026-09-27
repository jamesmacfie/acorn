import type { DataBinding, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { WorkflowCatalog, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { stepIdentity } from '../../shared/workflowIdentity'
import { stepKindPluginId, unavailableCatalogKind } from '../../shared/stepKindAvailability'
import { effectiveAfter } from './draft'

const kindOf = (step: WorkflowStepDef) => step.kind ?? 'agent'

const targetName = (step: WorkflowStepDef, catalog: WorkflowCatalog | undefined): string => {
  const ref = step.childWorkflow?.ref
  if (!ref) return 'a child workflow'
  const target = catalog?.workflows?.find(candidate => {
    if (candidate.ref.source !== ref.source) return false
    if (candidate.ref.source === 'repo' && ref.source === 'repo') return candidate.ref.path === ref.path
    return candidate.ref.source !== 'repo' && ref.source !== 'repo' && candidate.ref.id === ref.id
  })
  return target?.name ?? 'an unavailable workflow'
}

const bindingLabel = (binding: DataBinding | undefined, def: WorkflowDef): string => {
  const address = binding?.address
  if (!address) return 'a field'
  const pointer = address.from === 'literal' ? '' : address.pointer
  const field = pointer ? pointer.split('/').filter(Boolean).at(-1)?.replace(/~1/g, '/').replace(/~0/g, '~') : undefined
  if (address.from === 'literal') return JSON.stringify(address.value)
  if (address.from === 'input') return field ?? address.name
  if (address.from === 'item') return field ?? 'current record'
  return field ?? def.steps.find(step => stepIdentity(step) === address.stepId)?.name ?? 'step result'
}

function conditionLabel(condition: DataPredicate | undefined, def: WorkflowDef): string {
  if (!condition) return 'Choose a field and comparison.'
  if (condition.kind !== 'comparison') return `${condition.kind === 'all' ? 'All' : 'Any'} of ${condition.predicates.length} conditions match.`
  const operator = ({ eq: 'is', ne: 'is not', lt: 'is less than', lte: 'is at most', gt: 'is greater than',
    gte: 'is at least', contains: 'contains', in: 'is in', missing: 'is missing', present: 'is present' } as const)[condition.operator]
  return `${bindingLabel(condition.left, def)} ${operator}${condition.right ? ` ${bindingLabel(condition.right, def)}` : ''}.`
}

export function stepSummary(step: WorkflowStepDef, def: WorkflowDef, catalog: WorkflowCatalog | undefined): string {
  const kind = kindOf(step)
  if (unavailableCatalogKind(kind, catalog)) {
    const pluginId = stepKindPluginId(kind)
    return pluginId ? `Plugin '${pluginId}' does not provide this step on this node.` : `Step kind '${kind}' is unavailable on this node.`
  }
  if (kind === 'find-records') {
    const query = step.query
    if (!query) return 'Choose records to find.'
    if (query.kind === 'saved') return 'Find records with a saved query.'
    const source = query.content.query.source
    return `Find records from ${source.pluginId} · ${source.sourceId}.`
  }
  if (kind === 'workflow-map') {
    const source = def.steps.find(candidate => stepIdentity(candidate) === step.items?.step)?.name ?? 'chosen records'
    return `For each result from ${source}, run ${targetName(step, catalog)}.`
  }
  if (kind === 'workflow') return `Run ${targetName(step, catalog)}.`
  if (kind === 'if') return `If ${conditionLabel(step.condition, def)}`
  if (kind === 'decide') return 'Ask AI to choose a branch.'
  if (kind === 'get-record-details') return 'Fetch details for the selected record.'
  if (kind === 'agent' && step.schema && typeof step.schema === 'object') {
    const fields = Object.keys((step.schema as { properties?: object }).properties ?? {})
    return fields.length ? `Ask an agent to return ${fields.join(', ')}.` : 'Ask an agent for structured output.'
  }
  const described = catalog?.kinds.find(entry => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind]
  return described?.description ?? `Run ${described?.label ?? kind}.`
}

export function dependencyLabels(step: WorkflowStepDef, def: WorkflowDef): string[] {
  const index = def.steps.findIndex(candidate => stepIdentity(candidate) === stepIdentity(step))
  return effectiveAfter(def, index).map(id => def.steps.find(candidate => stepIdentity(candidate) === id)?.name ?? id)
}

export function branchLabel(step: WorkflowStepDef, def: WorkflowDef): string | undefined {
  for (const parent of def.steps) {
    for (const [branch, target] of Object.entries(parent.branches ?? {})) {
      if (target !== stepIdentity(step)) continue
      if (kindOf(parent) === 'if') return branch === 'true' ? 'If' : 'Otherwise'
      return branch
    }
  }
  return undefined
}

/** Human-readable references shown before a destructive delete. The mutation rules decide what is
 *  detached; this list exists so a binding or branch never disappears as a surprise. */
export function referenceLabels(id: string, def: WorkflowDef): string[] {
  const references: string[] = []
  const visitsBinding = (binding: unknown): boolean => {
    if (!binding || typeof binding !== 'object') return false
    if ('address' in binding) {
      const address = (binding as DataBinding).address
      return address.from === 'step' && address.stepId === id
    }
    return (binding as { from?: string; step?: string }).from === 'step'
      && (binding as { step?: string }).step === id
  }
  for (const [index, step] of def.steps.entries()) {
    const label = step.name
    if (effectiveAfter(def, index).includes(id)) references.push(`${label} dependency`)
    if (step.items?.step === id) references.push(`${label} records`)
    if (Object.values(step.childWorkflow?.inputs ?? {}).some(visitsBinding)) references.push(`${label} child input`)
    if (Object.values(step.title?.bindings ?? {}).some(visitsBinding)) references.push(`${label} title`)
    if (Object.values(step.branches ?? {}).includes(id)) references.push(`${label} branch`)
  }
  return [...new Set(references)]
}
