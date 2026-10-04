import { createMemo, Match, Show, Switch, type JSX } from 'solid-js'
import type { PanelPlan, PanelPlanColumn } from '@acorn/protocol/dashboards.ts'
import type { DataBindingAddress, DataOperator, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { calendarLabel, offsetLabel, operatorLabel } from '@acorn/dashboards-core/labels.ts'
import { Button } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import { LabeledInput, LabeledSelect } from '../fields'
import type { StudioChangeOptions } from './studioStore'

// What the step forms share: the props every form takes, and one condition (column, comparison, and
// value) with typed value pickers. The filter step and a measure's "Only count rows where" both use
// the condition (docs/dashboards/mapping-and-editor.md § The generated editor).

export type Stage = PanelPlan['stages'][number]
export type Comparison = Extract<DataPredicate, { kind: 'comparison' }>

/** What every step form takes. `columns` are the columns the step reads: the output after the steps
 *  before it. `sources` are each source's description by source id, once its picker has described it. */
export type StageFormProps<Op extends Stage['op'] = Stage['op']> = {
  stage: Extract<Stage, { op: Op }>
  columns: readonly PanelPlanColumn[]
  plan: PanelPlan
  sources: Readonly<Record<string, DataSourceDescription | undefined>>
  onChange: (stage: Extract<Stage, { op: Op }>, options?: StudioChangeOptions) => void
}

/** Columns as `Select` options. A stored id the step can't read any more shows as missing rather than
 *  as the bare id. */
export function columnOptions(columns: readonly PanelPlanColumn[], current?: string): { value: string; label: string }[] {
  const options = columns.map(column => ({ value: column.id, label: column.label }))
  return current && !columns.some(column => column.id === current) ? [{ value: current, label: 'Missing column, choose another' }, ...options] : options
}

/** A step part this form can't edit, such as a deeply nested condition, shown in words. */
export const ReadOnlyPart = (props: { children: string }) => <Stack gap="none">
  <Text wrap>{props.children}</Text>
  <Text emphasis="muted" wrap>Edit this in the Plan tab or with AI.</Text>
</Stack>

/** A sub-form drawn one step in from its parent, for nested calculations. */
export const Nested = (props: { children: JSX.Element }) => <div class="dash-studio-nested">{props.children}</div>

/** A whole number from an input, or undefined when it's empty or not a number. */
export const wholeNumber = (raw: string): number | undefined => raw.trim() && Number.isInteger(Number(raw)) ? Number(raw) : undefined

// ── Conditions ─────────────────────────────────────────────────────────────────────────────────────

/** The comparisons offered for each column type, in the order a person reaches for them. */
const OPERATORS: Record<NonNullable<PanelPlanColumn['type']>, DataOperator[]> = {
  text: ['eq', 'ne', 'contains', 'in', 'missing', 'present'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'missing', 'present'],
  boolean: ['eq', 'missing', 'present'],
  datetime: ['gt', 'lt', 'missing', 'present'],
  enum: ['eq', 'ne', 'missing', 'present'],
  person: ['eq', 'ne', 'missing', 'present'],
  link: ['eq', 'ne', 'missing', 'present'],
}
export const operatorsFor = (column: PanelPlanColumn | undefined): DataOperator[] =>
  column?.list ? ['contains', 'missing', 'present'] : OPERATORS[column?.type ?? 'text']
const isPresence = (operator: DataOperator) => operator === 'missing' || operator === 'present'

/** The relative dates a date condition offers, written as the context addresses the schema stores. */
export const DATE_PRESETS: readonly { label: string; address: DataBindingAddress }[] = [
  { label: 'Today', address: { from: 'context', name: 'calendar', boundary: 'startOfDay' } },
  { label: 'Start of this week', address: { from: 'context', name: 'calendar', boundary: 'startOfWeek' } },
  { label: 'Start of this month', address: { from: 'context', name: 'calendar', boundary: 'startOfMonth' } },
  { label: '7 days ago', address: { from: 'context', name: 'now', offset: '-P7D' } },
  { label: '30 days ago', address: { from: 'context', name: 'now', offset: '-P30D' } },
  { label: '90 days ago', address: { from: 'context', name: 'now', offset: '-P90D' } },
]
const SPECIFIC_DATE = 'literal'
/** A relative date's `Select` value. Built from its parts, so a stored address matches its preset
 *  whatever order its keys were written in. */
const dateKey = (address: DataBindingAddress | undefined): string => address?.from !== 'context' ? SPECIFIC_DATE
  : address.name === 'now' ? `now:${address.offset ?? ''}` : address.name === 'calendar' ? `calendar:${address.boundary}:${address.offset ?? ''}` : address.name
const dateWords = (address: DataBindingAddress): string => {
  if (address.from !== 'context') return 'A specific date'
  if (address.name === 'now') return address.offset ? offsetLabel(address.offset) : 'Now'
  if (address.name === 'calendar') { const words = calendarLabel(address.boundary, address.offset); return words[0]!.toUpperCase() + words.slice(1) }
  return address.name === 'viewer' ? 'You' : 'Workspace links'
}
/** A picked day as the value a date column compares: the day itself for a calendar-day column, the
 *  local midnight's instant otherwise, as the relative dates resolve. */
const dayValue = (day: string, column: PanelPlanColumn | undefined): DataValue =>
  !day ? '' : column?.precision === 'day' ? day : new Date(`${day}T00:00:00`).getTime()
const dayText = (value: DataValue): string => {
  if (typeof value === 'string') return value.slice(0, 10)
  if (typeof value !== 'number') return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The value a new condition on this column starts with. */
function defaultRight(column: PanelPlanColumn | undefined, operator: DataOperator, viewer: string | undefined): DataBindingAddress | undefined {
  if (isPresence(operator)) return undefined
  if (operator === 'in') return { from: 'literal', value: [] }
  const type = column?.type ?? 'text'
  if (type === 'datetime') return DATE_PRESETS[0]!.address
  if (type === 'person' && viewer) return { from: 'context', name: 'viewer', pointer: viewer }
  return { from: 'literal', value: type === 'number' ? 0 : type === 'boolean' ? true : type === 'enum' ? column?.choices?.[0]?.id ?? '' : '' }
}

/** A complete condition on this column, with its first comparison and a starting value. */
export function newComparison(column: PanelPlanColumn | undefined, viewer?: string, operator = operatorsFor(column)[0]!): Comparison {
  const right = defaultRight(column, operator, viewer)
  return { kind: 'comparison', left: { address: { from: 'item', pointer: `/${column?.id ?? ''}` } }, operator, ...(right ? { right: { address: right } } : {}) }
}

export const comparisonColumn = (comparison: Comparison): string | undefined => {
  const address = comparison.left.address
  return address.from === 'item' && /^\/[A-Za-z0-9_-]{1,100}$/.test(address.pointer) ? address.pointer.slice(1) : undefined
}

/** Whether the condition form can edit this comparison: a column on the left, and a fixed value, a
 *  relative date, or "you" on the right. */
export const editableComparison = (predicate: DataPredicate): predicate is Comparison => {
  if (predicate.kind !== 'comparison' || !comparisonColumn(predicate)) return false
  const right = predicate.right?.address
  return !right || right.from === 'literal' || (right.from === 'context' && right.name !== 'workspaceLinks')
}

/** The field a column reads can match the viewer, as `viewerMatch` declares. Only for one-source
 *  plans, because "you" resolves through that one source's account. */
export function viewerPointer(plan: PanelPlan, sources: StageFormProps['sources'], columnId: string | undefined): string | undefined {
  if (plan.sources.length !== 1) return undefined
  const source = plan.sources[0]!
  const binding = plan.columns.find(column => column.id === columnId)?.bind[source.id]
  return binding && 'field' in binding ? sources[source.id]?.fields.find(field => field.pointer === binding.field)?.viewerMatch : undefined
}

/** One condition: a column, a comparison that fits the column's type, and a value picker for it. */
export function ConditionEditor(props: {
  value: Comparison
  columns: readonly PanelPlanColumn[]
  /** The viewer pointer for a column, when the column can match "you". */
  viewer: (columnId: string | undefined) => string | undefined
  onChange: (value: Comparison, options?: StudioChangeOptions) => void
  onRemove?: () => void
}) {
  const columnId = () => comparisonColumn(props.value)
  const column = () => props.columns.find(entry => entry.id === columnId())
  const right = () => props.value.right?.address
  const literal = (): DataValue => right()?.from === 'literal' ? (right() as Extract<DataBindingAddress, { from: 'literal' }>).value : ''
  const setRight = (address: DataBindingAddress, options?: StudioChangeOptions) => props.onChange({ ...props.value, right: { address } }, options)
  const setLiteral = (value: DataValue, options?: StudioChangeOptions) => setRight({ from: 'literal', value }, options)
  const operators = () => {
    const offered = operatorsFor(column())
    return offered.includes(props.value.operator) ? offered : [props.value.operator, ...offered]
  }
  const pickColumn = (id: string) => {
    const next = props.columns.find(entry => entry.id === id)
    const keep = next?.type === column()?.type && !!next?.list === !!column()?.list
    props.onChange(keep ? { ...props.value, left: { address: { from: 'item', pointer: `/${id}` } } } : newComparison(next, props.viewer(id)))
  }
  const pickOperator = (operator: DataOperator) => {
    const kept = !isPresence(operator) && !isPresence(props.value.operator) && (operator === 'in') === (props.value.operator === 'in')
    const address = kept ? right() : defaultRight(column(), operator, props.viewer(columnId()))
    const { right: _right, ...rest } = props.value
    props.onChange({ ...rest, operator, ...(address ? { right: { address } } : {}) })
  }
  const dateOptions = () => {
    const presets = DATE_PRESETS.map(preset => ({ value: dateKey(preset.address), label: preset.label }))
    const stored = right()
    const custom = stored && !presets.some(option => option.value === dateKey(stored)) && dateKey(stored) !== SPECIFIC_DATE ? [{ value: dateKey(stored), label: dateWords(stored) }] : []
    return [...presets, ...custom, { value: SPECIFIC_DATE, label: 'A specific date' }]
  }
  const pickDate = (key: string) => {
    if (key === dateKey(right())) return
    const preset = DATE_PRESETS.find(entry => dateKey(entry.address) === key)
    setRight(preset ? preset.address : { from: 'literal', value: '' })
  }

  // Which value picker the condition shows. A memo of its own, so typing a value doesn't rebuild the
  // picker under the caret.
  const picker = createMemo(() => {
    const type = column()?.type ?? 'text'
    return isPresence(props.value.operator) ? 'none' : props.value.operator === 'in' ? 'list' : type === 'datetime' ? 'date'
      : type === 'person' && props.viewer(columnId()) ? 'person' : type === 'enum' && column()?.choices?.length ? 'choice'
        : type === 'boolean' || type === 'number' ? type : 'text'
  })
  const choiceOptions = () => {
    const choices = column()?.choices ?? []
    return [...(choices.some(choice => choice.id === literal()) ? [] : [{ value: String(literal() ?? ''), label: 'Choose a value' }]), ...choices.map(choice => ({ value: choice.id, label: choice.label }))]
  }

  return <div class="dash-studio-condition">
    <LabeledSelect label="Column" value={columnId() ?? ''} options={columnOptions(props.columns, columnId())} onChange={pickColumn} />
    <LabeledSelect label="Comparison" value={props.value.operator} options={operators().map(value => ({ value, label: operatorLabel(value, column()?.type) }))}
      onChange={operator => pickOperator(operator as DataOperator)} />
    <Switch>
      <Match when={picker() === 'list'}><LabeledInput label="Values" hint="Separate values with commas" value={Array.isArray(literal()) ? (literal() as DataValue[]).join(', ') : ''}
        onInput={raw => setLiteral(raw.split(',').map(item => item.trim()).filter(Boolean), { coalesce: true })} /></Match>
      <Match when={picker() === 'date'}>
        <LabeledSelect label="Date" value={dateKey(right())} options={dateOptions()} onChange={pickDate} />
        <Show when={right()?.from === 'literal'}><LabeledInput label="Day" type="date" value={dayText(literal())} onInput={day => setLiteral(dayValue(day, column()))} /></Show>
      </Match>
      <Match when={picker() === 'person'}>
        <LabeledSelect label="Person" value={right()?.from === 'context' ? 'viewer' : 'someone'} options={[{ value: 'viewer', label: 'You' }, { value: 'someone', label: 'Someone else' }]}
          onChange={who => who === 'viewer' ? setRight({ from: 'context', name: 'viewer', pointer: props.viewer(columnId())! }) : setLiteral('')} />
        <Show when={right()?.from === 'literal'}><LabeledInput label="Name or login" value={String(literal() ?? '')} onInput={value => setLiteral(value, { coalesce: true })} /></Show>
      </Match>
      <Match when={picker() === 'choice'}><LabeledSelect label="Value" value={String(literal() ?? '')} options={choiceOptions()} onChange={setLiteral} /></Match>
      <Match when={picker() === 'boolean'}><LabeledSelect label="Value" value={String(literal() === true)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} onChange={value => setLiteral(value === 'true')} /></Match>
      <Match when={picker() === 'number'}><LabeledInput label="Value" type="number" value={typeof literal() === 'number' ? String(literal()) : ''}
        onInput={raw => setLiteral(raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : '', { coalesce: true })} /></Match>
      <Match when={picker() === 'text'}><LabeledInput label="Value" value={typeof literal() === 'string' ? literal() as string : String(literal() ?? '')} onInput={value => setLiteral(value, { coalesce: true })} /></Match>
    </Switch>
    <Show when={props.onRemove}>{remove => <Inline><Button size="sm" variant="bare" onPress={remove()}>Remove condition</Button></Inline>}</Show>
  </div>
}
