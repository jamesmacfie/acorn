// The approval form on a `gate-human` step (docs/workflows.md § Human gates). Shared, because the
// node checks an answer with these functions and the run pane runs the same check before it sends
// one, so a problem shows under its field before the request instead of after it.
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { canonicalDataEncoding, DATA_LIMITS, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowGateForm, WorkflowStepDef } from './workflowContracts'

// ponytail: a proposed cap, not a measured one. Raise it if a real form needs more.
export const GATE_FORM_MAX_FIELDS = 20

/** What a gate with a form proposes and what its reviewer approved, as frozen into the step's
 *  `inputsJson` and `structuredJson`. */
export type GateFormProposal = { form: { values: Record<string, DataValue> } }
export type GateFormOutput = { approved: true | 'autonomous'; values: Record<string, DataValue>; edited: string[] }

const fieldSchema = (schema: DataSchema | undefined): DataSchema => schema ?? { type: 'string' }

/** The gate's output schema, derived from its fields. `approved` is left out of the properties,
 *  because it is `true` or `'autonomous'` and the schema subset has no union of two types. */
export function gateFormOutputSchema(form: WorkflowGateForm): DataSchema {
  return {
    type: 'object',
    properties: {
      values: {
        type: 'object',
        properties: Object.fromEntries(form.fields.map((field) => [field.name, fieldSchema(field.schema)])),
        required: form.fields.filter((field) => field.required).map((field) => field.name),
        additionalProperties: false,
      },
      edited: { type: 'array', items: { type: 'string' } },
    },
    required: ['values', 'edited'],
  }
}

/** A step's output schema when it has one: its declared schema, a form gate's derived one, or the
 *  kind's fixed one. The one answer the editor's binding picker and the runner's output check share. */
export function declaredOutputSchema(step: WorkflowStepDef, kindSchema: object | undefined): DataSchema | undefined {
  if (step.schema) return step.schema as DataSchema
  if ((step.kind ?? 'agent') === 'gate-human' && step.form) return gateFormOutputSchema(step.form)
  return kindSchema as DataSchema | undefined
}

/** One problem per field, keyed by field name, for a set of values a person means to approve. An
 *  empty object means the values can be approved. */
export function gateFormProblems(form: WorkflowGateForm, values: Readonly<Record<string, unknown>>): Record<string, string> {
  const problems: Record<string, string> = {}
  const declared = new Map(form.fields.map((field) => [field.name, field]))
  for (const name of Object.keys(values)) {
    if (!declared.has(name)) problems[name] = 'This form has no such field.'
  }
  for (const field of form.fields) {
    const value = values[field.name]
    if (value === undefined) {
      if (field.required) problems[field.name] = 'A value is required.'
      continue
    }
    try {
      validateDataValue(value, fieldSchema(field.schema), DATA_LIMITS.selectionBytes)
    } catch (error) {
      problems[field.name] = error instanceof Error ? error.message : 'This value does not match the field.'
    }
  }
  return problems
}

/** The fields whose approved value differs from the proposal, in field order. */
export function gateFormEdited(form: WorkflowGateForm, proposal: Readonly<Record<string, DataValue>>, approved: Readonly<Record<string, DataValue>>): string[] {
  const encode = (value: DataValue | undefined) => value === undefined ? undefined : canonicalDataEncoding(value)
  return form.fields.map((field) => field.name).filter((name) => encode(proposal[name]) !== encode(approved[name]))
}
