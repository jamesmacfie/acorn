import type { BindingOrigin } from '@acorn/plugin-api/client'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { StepKindDescription, WorkflowCatalog, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { stepIdentity } from '../../shared/workflowIdentity'
import { precedes } from './draft'

const describedKind = (step: WorkflowStepDef, catalog: WorkflowCatalog | undefined): StepKindDescription | undefined => {
  const kind = step.kind ?? 'agent'
  return catalog?.kinds.find(entry => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind]
}

export const workflowOutputSchema = (step: WorkflowStepDef, catalog: WorkflowCatalog | undefined): DataSchema | undefined => {
  if (step.schema) return step.schema as DataSchema
  return describedKind(step, catalog)?.output?.schema as DataSchema | undefined
}

const unescapePointer = (value: string) => value.replace(/~1/g, '/').replace(/~0/g, '~')

/** Resolve the bounded structural-schema subset with the same JSON Pointer vocabulary bindings use. */
export function schemaAtPointer(schema: DataSchema | undefined, pointer: string): DataSchema | undefined {
  if (!schema || !pointer) return schema
  if (!pointer.startsWith('/')) return undefined
  let current: DataSchema | undefined = schema
  for (const raw of pointer.slice(1).split('/')) {
    if (!current) return undefined
    const part = unescapePointer(raw)
    const type = Array.isArray(current.type) ? current.type.find(value => value !== 'null') : current.type
    if (type === 'object') current = current.properties?.[part]
    else if (type === 'array' && /^\d+$/.test(part)) current = current.items
    else return undefined
  }
  return current
}

export function workflowMapItemSchema(
  def: WorkflowDef,
  step: WorkflowStepDef,
  catalog: WorkflowCatalog | undefined,
): DataSchema | undefined {
  const source = def.steps.find(candidate => stepIdentity(candidate) === step.items?.step)
  const selected = source ? schemaAtPointer(workflowOutputSchema(source, catalog), step.items?.pointer ?? '') : undefined
  const type = selected && (Array.isArray(selected.type) ? selected.type.find(value => value !== 'null') : selected.type)
  return type === 'array' && selected ? selected.items : undefined
}

/** Only values admission already permits: workflow inputs and transitive predecessor results. */
export function workflowBindingOrigins(
  def: WorkflowDef,
  current: WorkflowStepDef,
  catalog: WorkflowCatalog | undefined,
  options: { includeItem?: boolean } = {},
): BindingOrigin[] {
  const inputs: BindingOrigin[] = (def.inputs ?? []).map(input => ({
    kind: 'input', name: input.name, label: input.description || input.name,
    schema: input.schema ?? { type: 'string' },
  }))
  const steps: BindingOrigin[] = def.steps.flatMap(step => {
    const schema = workflowOutputSchema(step, catalog)
    return stepIdentity(step) !== stepIdentity(current) && schema && precedes(def, stepIdentity(step), stepIdentity(current))
      ? [{ kind: 'step' as const, stepId: stepIdentity(step), label: step.name, schema }]
      : []
  })
  const item = options.includeItem ? workflowMapItemSchema(def, current, catalog) : undefined
  return [...inputs, ...(item ? [{ kind: 'item' as const, label: 'Current record', schema: item }] : []), ...steps]
}
