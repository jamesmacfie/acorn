import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataField } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema, DataType } from '@acorn/protocol/dataSchemas.ts'
import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'

export type BindingOrigin =
  | { kind: 'input'; name: string; label: string; schema: DataSchema; example?: DataValue; fields?: readonly DataField[] }
  | { kind: 'item'; label: string; schema: DataSchema; example?: DataValue; fields?: readonly DataField[] }
  | { kind: 'step'; stepId: string; label: string; schema: DataSchema; example?: DataValue; fields?: readonly DataField[] }

export type BindingCompatibility =
  | { kind: 'exact' }
  | { kind: 'conversion'; conversion: NonNullable<DataBinding['conversion']>; label: string }
  | { kind: 'incompatible'; reason: string }

export type BindingCandidate = {
  id: string
  origin: BindingOrigin
  pointer: string
  label: string
  schema: DataSchema
  typeLabel: string
  optional: boolean
  observed: boolean
  example?: DataValue
  compatibility: BindingCompatibility
}

const primaryTypes = (schema: DataSchema): DataType[] => Array.isArray(schema.type) ? schema.type : [schema.type]
export const schemaTypeLabel = (schema: DataSchema): string => primaryTypes(schema).join(' or ')
const scalar = (schema: DataSchema) => primaryTypes(schema).every(type => ['string', 'number', 'integer', 'boolean', 'null'].includes(type))

export function bindingCompatibility(source: DataSchema, destination: DataSchema): BindingCompatibility {
  const sourceTypes = primaryTypes(source)
  const destinationTypes = primaryTypes(destination)
  const exact = sourceTypes.every(type => destinationTypes.includes(type)
    || (type === 'integer' && destinationTypes.includes('number')))
  if (exact) return { kind: 'exact' }
  if (destinationTypes.includes('string')) {
    return scalar(source)
      ? { kind: 'conversion', conversion: 'scalar-to-text', label: 'Convert value to text' }
      : { kind: 'conversion', conversion: 'json-to-text', label: 'Convert JSON to text' }
  }
  return { kind: 'incompatible', reason: `${schemaTypeLabel(source)} cannot be used where ${schemaTypeLabel(destination)} is required.` }
}

const escapePointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1')

export function bindingCandidates(origins: readonly BindingOrigin[], destination?: DataSchema): BindingCandidate[] {
  const candidates: BindingCandidate[] = []
  for (const origin of origins) {
    const metadata = new Map(origin.fields?.map(field => [field.pointer, field]) ?? [])
    const visit = (schema: DataSchema, pointer: string, label: string, optional: boolean): void => {
      const field = metadata.get(pointer)
      const read = origin.example === undefined ? MISSING : readDataPointer(origin.example, pointer)
      const compatibility = destination ? bindingCompatibility(schema, destination) : { kind: 'exact' as const }
      candidates.push({
        id: `${origin.kind}:${origin.kind === 'input' ? origin.name : origin.kind === 'step' ? origin.stepId : 'item'}:${pointer}`,
        origin, pointer, label: field?.label ?? label, schema, typeLabel: schemaTypeLabel(schema),
        optional: optional || field?.origin === 'observed', observed: field?.origin === 'observed',
        ...(read === MISSING ? {} : { example: read }), compatibility,
      })
      const type = primaryTypes(schema).find(value => value !== 'null')
      if (type !== 'object') return
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        visit(child, `${pointer}/${escapePointer(key)}`, key, optional || !(schema.required ?? []).includes(key))
      }
    }
    visit(origin.schema, '', origin.label, false)
  }
  const rank = (candidate: BindingCandidate) => candidate.compatibility.kind === 'exact' ? 0
    : candidate.compatibility.kind === 'conversion' ? 1 : 2
  return candidates.sort((left, right) => rank(left) - rank(right)
    || left.origin.label.localeCompare(right.origin.label) || left.pointer.localeCompare(right.pointer))
}

export function bindingForCandidate(candidate: BindingCandidate, fallback?: DataValue): DataBinding {
  const address = candidate.origin.kind === 'input'
    ? { from: 'input' as const, name: candidate.origin.name, pointer: candidate.pointer }
    : candidate.origin.kind === 'step'
      ? { from: 'step' as const, stepId: candidate.origin.stepId, pointer: candidate.pointer }
      : { from: 'item' as const, pointer: candidate.pointer }
  return {
    address,
    ...(candidate.compatibility.kind === 'conversion' ? { conversion: candidate.compatibility.conversion } : {}),
    ...(fallback === undefined ? {} : { fallback }),
  }
}

export function candidateForBinding(candidates: readonly BindingCandidate[], binding: DataBinding | undefined): BindingCandidate | undefined {
  if (!binding) return undefined
  const address = binding.address
  if (address.from === 'literal' || address.from === 'context') return undefined
  return candidates.find(candidate => {
    if (candidate.pointer !== address.pointer || candidate.origin.kind !== address.from) return false
    if (address.from === 'input' && candidate.origin.kind === 'input') return candidate.origin.name === address.name
    if (address.from === 'step' && candidate.origin.kind === 'step') return candidate.origin.stepId === address.stepId
    return address.from === 'item'
  })
}
