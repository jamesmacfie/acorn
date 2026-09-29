import { dataBindingSchema } from '@acorn/protocol/dataBindings.ts'
import { readDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import { parseDataSchema, validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { DATA_LIMITS, MISSING, canonicalDataEncoding, parseDataValue, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowDef, WorkflowStepDef, WorkflowStepRow } from '../../shared/workflowContracts'
import { rowIdentity, stepIdentity } from '../../shared/workflowIdentity'

export const WORKFLOW_VALUE_BYTES = DATA_LIMITS.selectionBytes

/** Text exists only at a prompt/title boundary. Structured values remain untouched. */
export function workflowText(value: DataValue): string {
  return typeof value === 'string' ? value : canonicalDataEncoding(parseDataValue(value, WORKFLOW_VALUE_BYTES))
}

export function workflowValueProblems(def: WorkflowDef): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const step of def.steps) {
    if (typeof step.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(step.id) || step.id.length > 200) errors.push(`Step '${step.name}' needs a stable ID using letters, numbers, colons, dashes or underscores.`)
    else if (ids.has(step.id)) errors.push(`Step ID '${step.id}' is repeated.`)
    else ids.add(step.id)
    for (const binding of [...Object.values(step.childWorkflow?.inputs ?? {}), ...Object.values(step.title?.bindings ?? {})]) {
      if (!dataBindingSchema.safeParse(binding).success) errors.push(`Step '${step.name}' uses an old-format binding. Replace it with binding_json containing a typed address.`)
    }
    if (step.schema) {
      try { parseDataSchema(step.schema) } catch (error) { errors.push(`Step '${step.name}' output schema: ${String(error)}`) }
    }
  }
  for (const input of def.inputs ?? []) {
    try {
      if (!input.schema) throw new Error('A typed schema is required')
      parseDataSchema(input.schema)
      if (input.default !== undefined) validateDataValue(input.default, input.schema, WORKFLOW_VALUE_BYTES)
    } catch (error) { errors.push(`Input '${input.name}': ${String(error)}`) }
  }
  const names = new Set<string>()
  for (const output of def.outputs ?? []) {
    try {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(output.name) || names.has(output.name)) throw new Error('Invalid or repeated name')
      names.add(output.name)
      parseDataSchema(output.schema)
      const binding = dataBindingSchema.parse(output.binding)
      if (binding.address.from !== 'step' || !ids.has(binding.address.stepId)) throw new Error('Outputs must bind a declared step ID')
    } catch (error) { errors.push(`Output '${output.name}': ${String(error)}`) }
  }
  return errors
}

export function completedWorkflowValues(def: WorkflowDef, rows: readonly WorkflowStepRow[]): Record<string, DataValue> {
  return Object.fromEntries(rows.filter(row => row.parentStepId == null && ['done', 'completed-with-failures'].includes(row.status) && row.structuredJson !== null)
    .map(row => [rowIdentity(def, row), parseDataValue(JSON.parse(row.structuredJson!), WORKFLOW_VALUE_BYTES)]))
}

export function workflowOutputs(def: WorkflowDef, rows: readonly WorkflowStepRow[]): Record<string, DataValue> {
  const steps = completedWorkflowValues(def, rows)
  const result: Record<string, DataValue> = {}
  for (const output of def.outputs ?? []) {
    const value = readDataBinding(output.binding, { steps })
    if (value === MISSING) {
      if (output.required !== false) throw new Error(`Required workflow output '${output.name}' is missing`)
    } else result[output.name] = validateDataValue(value, output.schema, WORKFLOW_VALUE_BYTES)
  }
  return result
}

/** Uses the existing after representation, including transitive edges, never completion order. */
export function predecessorValues(def: WorkflowDef, step: WorkflowStepDef, rows: readonly WorkflowStepRow[]): Record<string, DataValue> {
  const ids = new Set<string>()
  const visit = (id: string): void => {
    if (ids.has(id)) return
    ids.add(id)
    const index = def.steps.findIndex(candidate => stepIdentity(candidate) === id)
    const source = def.steps[index]
    for (const parent of source?.after ?? (index > 0 ? [stepIdentity(def.steps[index - 1])] : [])) visit(parent)
  }
  for (const id of step.after ?? (def.steps.indexOf(step) > 0 ? [stepIdentity(def.steps[def.steps.indexOf(step) - 1])] : [])) visit(id)
  return Object.fromEntries(Object.entries(completedWorkflowValues(def, rows)).filter(([id]) => ids.has(id)))
}
