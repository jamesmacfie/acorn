import { createSignal, For, Show } from 'solid-js'
import type { DataBinding, DataOperator, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { DATA_OPERATORS } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { BindingCandidate, BindingOrigin } from '@acorn/plugin-api/client'
import { TypedBindingPicker } from '@acorn/plugin-api/ui/data-sources'
import { Alert, Button, Field, Fold, Icon, Inline, Select, Stack, Text } from '@acorn/plugin-api/ui'
import TypedValueField from './TypedValueField'

type Comparison = Extract<DataPredicate, { kind: 'comparison' }>

const addressFor = (origin: BindingOrigin): DataBinding => ({
  address: origin.kind === 'input'
    ? { from: 'input', name: origin.name, pointer: '' }
    : origin.kind === 'step'
      ? { from: 'step', stepId: origin.stepId, pointer: '' }
      : { from: 'item', pointer: '' },
})

const literal = (value: DataValue): DataBinding => ({ address: { from: 'literal', value } })
const literalValue = (binding: DataBinding | undefined) => binding?.address.from === 'literal' ? binding.address.value : undefined

const operatorsFor = (schema: DataSchema | undefined): DataOperator[] => {
  const types = schema ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : []
  if (!types.length) return [...DATA_OPERATORS]
  if (types.some(type => type === 'number' || type === 'integer')) return ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'missing', 'present']
  if (types.includes('boolean') || types.includes('null')) return ['eq', 'ne', 'missing', 'present']
  if (types.includes('array')) return ['eq', 'ne', 'contains', 'missing', 'present']
  return ['eq', 'ne', 'contains', 'missing', 'present']
}

const operatorLabel: Record<DataOperator, string> = {
  eq: 'is', ne: 'is not', lt: 'is less than', lte: 'is at most', gt: 'is greater than', gte: 'is at least',
  contains: 'contains', in: 'is in', missing: 'is missing', present: 'is present',
}

function ComparisonRow(props: {
  value: Comparison
  origins: readonly BindingOrigin[]
  disabled?: boolean
  onChange: (value: Comparison) => void
  onRemove?: () => void
}) {
  const [candidate, setCandidate] = createSignal<BindingCandidate>()
  const schema = () => candidate()?.schema ?? { type: 'string' as const }
  const presence = () => ['missing', 'present'].includes(props.value.operator)
  return <Fold label="Condition" level="sub" defaultOpen>
    <Stack gap="row">
      <TypedBindingPicker label="Field" origins={props.origins} value={props.value.left} disabled={props.disabled}
        destinationRequired={!presence()} onCandidateChange={setCandidate}
        onChange={left => left && props.onChange({ ...props.value, left })} />
      <Field label="Comparison" group>
        <Select label="Comparison" disabled={props.disabled} value={props.value.operator}
          options={operatorsFor(candidate()?.schema).map(value => ({ value, label: operatorLabel[value] }))}
          onChange={value => {
            const operator = value as DataOperator
            props.onChange(['missing', 'present'].includes(operator)
              ? { ...props.value, operator, right: undefined }
              : { ...props.value, operator, right: props.value.right ?? literal('') })
          }} />
      </Field>
      <Show when={!presence()}>
        <TypedValueField label="Value" schema={schema()} value={literalValue(props.value.right)} disabled={props.disabled}
          onChange={value => props.onChange({ ...props.value, right: literal(value ?? '') })} />
        <Show when={props.value.right && props.value.right.address.from !== 'literal'}>
          <Alert tone="warn">This value comes from another step. Edit it on the Code tab, or type a fixed value.</Alert>
        </Show>
      </Show>
      <Show when={props.onRemove}><Inline gap="row"><Button size="sm" variant="ghost" disabled={props.disabled} onPress={props.onRemove}>Remove condition</Button></Inline></Show>
    </Stack>
  </Fold>
}

/** A bounded, typed condition editor. It covers direct comparisons and one all/any group; the code
 *  view remains the escape hatch for deeper groups without becoming the normal path. */
export default function ConditionEditor(props: {
  value?: DataPredicate
  origins: readonly BindingOrigin[]
  disabled?: boolean
  onChange: (value: DataPredicate | undefined) => void
}) {
  const initial = (): Comparison | undefined => props.origins[0]
    ? { kind: 'comparison', left: addressFor(props.origins[0]), operator: 'eq', right: literal('') }
    : undefined
  const comparisons = () => props.value?.kind === 'comparison' ? [props.value]
    : props.value?.predicates.filter((value): value is Comparison => value.kind === 'comparison') ?? []
  const advanced = () => props.value?.kind !== 'comparison' && props.value?.predicates.some(value => value.kind !== 'comparison')
  const setAt = (at: number, value: Comparison) => {
    if (props.value?.kind === 'comparison') return props.onChange(value)
    const next = [...comparisons()]
    next[at] = value
    props.onChange({ kind: props.value?.kind ?? 'all', predicates: next })
  }
  const removeAt = (at: number) => {
    const next = comparisons().filter((_value, index) => index !== at)
    props.onChange(next.length === 0 ? undefined : next.length === 1 ? next[0] : { kind: props.value?.kind === 'any' ? 'any' : 'all', predicates: next })
  }
  const add = () => {
    const next = initial()
    if (!next) return
    const current = comparisons()
    props.onChange(!current.length ? next : { kind: props.value?.kind === 'any' ? 'any' : 'all', predicates: [...current, next] })
  }
  return <Stack gap="row">
    <Text emphasis="muted" wrap>Choose a typed field, compare it directly, then name the If and Otherwise destinations below.</Text>
    <Show when={advanced()}>
      <Alert tone="warn">This condition has nested groups. Edit it on the Code tab.</Alert>
    </Show>
    <Show when={!advanced()}>
    <Show when={props.value && props.value.kind !== 'comparison'}>
      <Field label="Match" group>
        <Select label="Match" disabled={props.disabled} value={props.value?.kind ?? 'all'}
          options={[{ value: 'all', label: 'All conditions' }, { value: 'any', label: 'Any condition' }]}
          onChange={kind => props.onChange({ kind: kind as 'all' | 'any', predicates: comparisons() })} />
      </Field>
    </Show>
    <For each={comparisons()}>{(comparison, at) => <ComparisonRow value={comparison} origins={props.origins}
      disabled={props.disabled} onChange={value => setAt(at(), value)}
      onRemove={comparisons().length > 1 ? () => removeAt(at()) : undefined} />}</For>
    <Show when={props.origins.length} fallback={<Alert tone="warn">To set a condition, add an input, or a step before this one that returns fields.</Alert>}>
      <Inline gap="row"><Button size="sm" disabled={props.disabled} onPress={add}><Icon name="plus" /> {comparisons().length ? 'Add condition' : 'Choose condition'}</Button></Inline>
    </Show>
    </Show>
  </Stack>
}
