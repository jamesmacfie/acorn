// Definition checks for the approval form on a `gate-human` step
// (docs/workflows/execution.md § Human gates). Here rather than in the kind's `validate`, because a
// binding check needs the declared inputs and which steps declare structured output, and the
// step-validator context that contributed kinds share carries neither.
import { parseDataSchema, validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import type { WorkflowPosture, WorkflowStepDef } from '../shared/workflowContracts'
import { GATE_FORM_MAX_FIELDS } from '../shared/gateForm'
import { stepIdentity } from '../shared/workflowIdentity'
import { bindingProblems } from './workflowDispatchValidation'
import { WORKFLOW_VALUE_BYTES } from './workflowValues'

const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/
const FIELD_KEYS = ['name', 'label', 'schema', 'description', 'required', 'default']

export function gateFormDefinitionProblems(args: {
  label: string
  step: WorkflowStepDef
  posture: WorkflowPosture | undefined
  declaredInputs: ReadonlySet<string>
  indexes: ReadonlyMap<string, number>
  precedes: (candidate: string, step: string) => boolean
  structured: (step: string) => boolean
}): string[] {
  const { label, step } = args
  const form = step.form as unknown
  if (form == null) return []
  const kind = step.kind ?? 'agent'
  if (kind !== 'gate-human') return [`${label} is a '${kind}' step, which cannot take form`]
  if (!form || typeof form !== 'object' || Array.isArray(form)) return [`${label} form must be a table`]
  const { fields, values } = form as { fields?: unknown; values?: unknown }
  const errors = Object.keys(form).filter((key) => key !== 'fields' && key !== 'values')
    .map((key) => `${label} form has unsupported field '${key}'`)
  if (!Array.isArray(fields) || !fields.length) return [...errors, `${label} form needs at least one field`]
  if (fields.length > GATE_FORM_MAX_FIELDS) errors.push(`${label} form has ${fields.length} fields; the limit is ${GATE_FORM_MAX_FIELDS}`)

  const names = new Set<string>()
  for (const [index, field] of fields.entries()) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      errors.push(`${label} form field ${index + 1} must be a table`)
      continue
    }
    const { name, schema, required, default: fallback } = field as Record<string, unknown>
    const where = `${label} form field '${typeof name === 'string' ? name : index + 1}'`
    if (typeof name !== 'string' || !FIELD_NAME_RE.test(name)) errors.push(`${label} form field ${index + 1} has an invalid name`)
    else if (names.has(name)) errors.push(`${where} is declared more than once`)
    else names.add(name)
    errors.push(...Object.keys(field).filter((key) => !FIELD_KEYS.includes(key)).map((key) => `${where} has unsupported field '${key}'`))
    if (required != null && typeof required !== 'boolean') errors.push(`${where} required must be true or false`)
    try {
      if (!schema) throw new Error('A typed schema is required')
      const parsed = parseDataSchema(schema)
      if (fallback !== undefined) validateDataValue(fallback, parsed, WORKFLOW_VALUE_BYTES)
    } catch (error) {
      errors.push(`${where}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (values != null && (typeof values !== 'object' || Array.isArray(values))) {
    errors.push(`${label} form.values must be a table`)
    return errors
  }
  const bound = (values ?? {}) as Record<string, unknown>
  for (const [name, binding] of Object.entries(bound)) {
    if (!names.has(name)) errors.push(`${label} form.values.${name} does not name a declared field`)
    else errors.push(...bindingProblems(`${label} form.values.${name}`, binding as never, args.declaredInputs, args.indexes, args.precedes, args.structured, stepIdentity(step), false))
  }
  // An autonomous run approves the proposal without asking anyone, so a required field has to be
  // filled by something other than a person. The runner checks again, because a run can still reach
  // a gate with nothing proposed.
  if (args.posture === 'autonomous') {
    for (const field of fields as Array<Record<string, unknown>>) {
      if (field?.required === true && field.default === undefined && typeof field.name === 'string' && !Object.hasOwn(bound, field.name)) {
        errors.push(`${label} form field '${field.name}' is required, and this workflow is autonomous, so nobody would be asked to fill it`)
      }
    }
  }
  return errors
}
