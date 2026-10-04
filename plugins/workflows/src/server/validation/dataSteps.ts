import { dataBindingSchema, parseDataPredicate, type DataBinding, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { queryReferenceSchema } from '@acorn/protocol/dataQueries.ts'
import type { StepValidationContext, WorkflowStepDef } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'

export function workflowDataProblems(step: WorkflowStepDef, context: StepValidationContext, inputs: ReadonlySet<string>): string[] {
  if (!['find-records', 'get-record-details', 'write-dataset', 'if'].includes(step.kind ?? '')) return []
  const errors: string[] = []
  const binding = (input: DataBinding) => {
    const { address } = dataBindingSchema.parse(input)
    if (address.from === 'step' && !context.precedes(address.stepId, stepIdentity(step))) errors.push('Binding must reference a predecessor')
    if (address.from === 'input' && !inputs.has(address.name)) errors.push('Binding references an undeclared input')
    if (address.from === 'item') errors.push('Step binding cannot reference an unbound item')
  }
  const predicate = (value: DataPredicate) => {
    if (value.kind !== 'comparison') value.predicates.forEach(predicate)
    else { binding(value.left); if (value.right) binding(value.right) }
  }
  try {
    if (step.kind === 'find-records') Object.values(queryReferenceSchema.parse(step.query).bindings).forEach(binding)
    if (step.kind === 'get-record-details') binding(dataBindingSchema.parse(step.record))
    if (step.kind === 'write-dataset') {
      if (!step.dataset?.id || !Number.isSafeInteger(step.dataset.version) || step.dataset.version < 1) errors.push('Dataset id and schema version are required')
      else binding(dataBindingSchema.parse(step.dataset.rows))
    }
    if (step.kind === 'if') {
      predicate(parseDataPredicate(step.condition))
      if (!step.branches?.true || !step.branches.otherwise || Object.keys(step.branches).some(key => !['true', 'otherwise'].includes(key))) errors.push('If requires true and otherwise branches')
      for (const target of Object.values(step.branches ?? {})) {
        if (!context.precedes(stepIdentity(step), target)) errors.push('If branch target must wait on the condition')
      }
    }
  } catch { errors.push('Invalid data step configuration. Check its typed query, record binding, or condition.') }
  return errors.map(error => `${context.label}: ${error}`)
}
