import type { DataBinding, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { pluginLabel } from '@acorn/plugin-api/client'
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
  const pointer = 'pointer' in address ? address.pointer : ''
  const field = pointer ? pointer.split('/').filter(Boolean).at(-1)?.replace(/~1/g, '/').replace(/~0/g, '~') : undefined
  if (address.from === 'literal') return JSON.stringify(address.value)
  if (address.from === 'input') return field ?? address.name
  if (address.from === 'item') return field ?? 'current record'
  if (address.from === 'context') return address.name === 'viewer' ? field ?? 'you'
    : address.name === 'workspaceLinks' ? 'workspace links' : address.name === 'now' ? 'now' : 'calendar time'
  return field ?? def.steps.find(step => stepIdentity(step) === address.stepId)?.name ?? 'step result'
}

function conditionLabel(condition: DataPredicate | undefined, def: WorkflowDef): string {
  if (!condition) return 'No condition yet.'
  if (condition.kind !== 'comparison') return `${condition.kind === 'all' ? 'All' : 'Any'} of ${condition.predicates.length} conditions match.`
  const operator = ({ eq: 'is', ne: 'is not', lt: 'is less than', lte: 'is at most', gt: 'is greater than',
    gte: 'is at least', contains: 'contains', in: 'is in', missing: 'is missing', present: 'is present' } as const)[condition.operator]
  return `${bindingLabel(condition.left, def)} ${operator}${condition.right ? ` ${bindingLabel(condition.right, def)}` : ''}.`
}

/** The outline row's second line. A summary only where it says something about this one step (what
 *  an If tests, what a For each reads, what a Find records asks for); otherwise the kind's label,
 *  because the kind's description already sits behind the inspector heading's help mark. */
export function stepSummary(step: WorkflowStepDef, def: WorkflowDef, catalog: WorkflowCatalog | undefined): string {
  const kind = kindOf(step)
  if (unavailableCatalogKind(kind, catalog)) {
    const pluginId = stepKindPluginId(kind)
    return pluginId ? `The ${pluginLabel(pluginId)} plugin isn't on this computer.` : "This kind of step isn't on this computer."
  }
  if (kind === 'find-records') {
    const query = step.query
    if (!query) return 'Choose records to find.'
    if (query.kind === 'saved') return 'Find records with a saved query.'
    return `Find ${pluginLabel(query.content.query.source.pluginId)} records.`
  }
  if (kind === 'workflow-map') {
    const source = def.steps.find(candidate => stepIdentity(candidate) === step.items?.step)?.name ?? 'chosen records'
    return step.agent ? `For each result from ${source}, start an agent session.`
      : `For each result from ${source}, run ${targetName(step, catalog)}.`
  }
  if (kind === 'workflow') return `Run ${targetName(step, catalog)}.`
  if (kind === 'if') return step.condition ? `If ${conditionLabel(step.condition, def)}` : conditionLabel(undefined, def)
  const described = catalog?.kinds.find(entry => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind]
  return described?.label ?? kind
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

/** The steps a delete would change, by name, shown before it happens. The mutation rules decide what
 *  is detached; this list exists so a binding or branch never disappears as a surprise. */
export function referencingSteps(id: string, def: WorkflowDef): string[] {
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
    if (effectiveAfter(def, index).includes(id)
      || step.items?.step === id
      || Object.values(step.childWorkflow?.inputs ?? {}).some(visitsBinding)
      || Object.values(step.title?.bindings ?? {}).some(visitsBinding)
      || Object.values(step.branches ?? {}).includes(id)) references.push(step.name)
  }
  return [...new Set(references)]
}
