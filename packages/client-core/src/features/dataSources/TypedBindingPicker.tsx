import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import { validateDataValue, type DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { Alert, Badge, Field, Inline, Input, Picker, Stack, Text } from '@acorn/client-core/features/dataSources/kit.ts'
import {
  bindingCandidates, bindingForCandidate, candidateForBinding,
  type BindingCandidate, type BindingOrigin,
} from './fieldPickerModel'

type PickerRow = { kind: 'heading'; id: string; label: string } | { kind: 'candidate'; candidate: BindingCandidate }

const originHeading = (kind: BindingOrigin['kind']) => kind === 'input' ? 'Workflow inputs'
  : kind === 'item' ? 'Current record' : 'Available step results'

function exampleLabel(value: DataValue | undefined): string {
  if (value === undefined) return 'No preview value'
  const encoded = typeof value === 'string' ? value : JSON.stringify(value)
  return `Example: ${encoded.length > 80 ? `${encoded.slice(0, 77)}…` : encoded}`
}

function parseFallback(raw: string, schema: DataSchema): DataValue {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const value: unknown = types.includes('string') && types.length === 1 ? raw : JSON.parse(raw)
  return validateDataValue(value, schema)
}

const conversionLabel = (candidate: BindingCandidate): string | undefined =>
  candidate.compatibility.kind === 'conversion' ? candidate.compatibility.label : undefined

/** Shared typed binding picker. It owns compatibility and presentation; consumers only provide
 *  admitted origins and the destination contract. */
export default function TypedBindingPicker(props: {
  label: string
  origins: readonly BindingOrigin[]
  /** Omit for a source-side choice, such as the left side of a condition, where every type is valid. */
  destination?: DataSchema
  destinationRequired?: boolean
  value?: DataBinding
  disabled?: boolean
  onChange(value: DataBinding | undefined): void
  onCandidateChange?(candidate: BindingCandidate | undefined): void
}) {
  const candidates = createMemo(() => bindingCandidates(props.origins, props.destination))
  const selected = createMemo(() => candidateForBinding(candidates(), props.value))
  createEffect(() => props.onCandidateChange?.(selected()))
  const rows = (query: string): PickerRow[] => {
    const needle = query.trim().toLowerCase()
    const matching = candidates().filter(candidate => !needle || [
      candidate.label, candidate.pointer, candidate.origin.label, candidate.typeLabel,
    ].join(' ').toLowerCase().includes(needle))
    const result: PickerRow[] = []
    for (const kind of ['input', 'item', 'step'] as const) {
      const group = matching.filter(candidate => candidate.origin.kind === kind)
      if (!group.length) continue
      result.push({ kind: 'heading', id: kind, label: originHeading(kind) })
      result.push(...group.map(candidate => ({ kind: 'candidate' as const, candidate })))
    }
    return result
  }
  const select = (row: PickerRow): void => {
    if (row.kind !== 'candidate' || row.candidate.compatibility.kind === 'incompatible') return
    props.onChange(bindingForCandidate(row.candidate, props.value?.fallback))
  }
  const [fallbackText, setFallbackText] = createSignal('')
  const [fallbackError, setFallbackError] = createSignal<string>()
  const updateFallback = (raw: string): void => {
    setFallbackText(raw)
    const current = selected()
    if (!current) return
    if (!raw) {
      setFallbackError(props.destinationRequired && current.optional ? 'A fallback is required for a field that may be missing.' : undefined)
      props.onChange(bindingForCandidate(current))
      return
    }
    try {
      props.onChange(bindingForCandidate(current, parseFallback(raw, props.destination ?? current.schema)))
      setFallbackError(undefined)
    } catch (error) {
      setFallbackError(error instanceof Error ? error.message : 'Enter a compatible value.')
    }
  }
  return (
    <Stack gap="row">
      <Field label={props.label} group>
        <Picker<PickerRow>
          label={selected() ? `${selected()!.origin.label} → ${selected()!.label}` : 'Choose a field…'}
          ariaLabel={props.label}
          placeholder="Search labels and paths"
          emptyText="No matching fields."
          disabled={props.disabled}
          results={rows}
          rowLabel={row => row.kind === 'heading' ? row.label : row.candidate.label}
          rowDescription={row => row.kind === 'heading' ? undefined : [
            row.candidate.origin.label,
            row.candidate.pointer || 'Whole value',
            row.candidate.typeLabel,
            row.candidate.optional ? 'May be missing' : undefined,
            row.candidate.observed ? 'Observed in preview' : undefined,
            exampleLabel(row.candidate.example),
            row.candidate.compatibility.kind === 'conversion' ? row.candidate.compatibility.label : undefined,
            row.candidate.compatibility.kind === 'incompatible' ? row.candidate.compatibility.reason : undefined,
          ].filter(Boolean).join(' · ')}
          isDisabled={row => row.kind === 'heading' || row.candidate.compatibility.kind === 'incompatible'}
          isActive={row => row.kind === 'candidate' && row.candidate.id === selected()?.id}
          onSelect={select}
        />
      </Field>
      <Show when={selected()}>{candidate => (
        <>
          <Inline gap="inline" wrap>
            <Badge>{candidate().typeLabel}</Badge>
            <Show when={candidate().optional}><Badge tone="warn">May be missing</Badge></Show>
            <Show when={candidate().observed}><Badge>Observed</Badge></Show>
          </Inline>
          <Text emphasis="muted" wrap>{exampleLabel(candidate().example)}</Text>
          <Show when={candidate().compatibility.kind === 'conversion'}>
            <Alert>{conversionLabel(candidate())}</Alert>
          </Show>
          <Show when={candidate().optional && props.destinationRequired}>
            <Field label="Fallback" hint="Used only when the selected field is missing." error={fallbackError()} group>
              <Input
                size="sm"
                label="Fallback"
                disabled={props.disabled}
                invalid={!!fallbackError()}
                value={fallbackText() || (props.value?.fallback === undefined ? '' : typeof props.value.fallback === 'string' ? props.value.fallback : JSON.stringify(props.value.fallback))}
                onInput={updateFallback}
              />
            </Field>
          </Show>
        </>
      )}</Show>
    </Stack>
  )
}
