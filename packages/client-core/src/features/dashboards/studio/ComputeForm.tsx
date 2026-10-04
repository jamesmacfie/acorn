import { createMemo, Index, Match, Show, Switch } from 'solid-js'
import type { PanelPlanColumn, PlanExpression } from '@acorn/protocol/dashboards.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { newColumnId } from '@acorn/dashboards-core/plan.ts'
import { ARITHMETIC_LABELS, DURATION_UNIT_LABELS, EXPRESSION_LABELS } from '@acorn/dashboards-core/labels.ts'
import { Button, Card } from '../../../kit/components/primitives'
import { Stack } from '../../../kit/components/layout/Stack'
import { LabeledInput, LabeledSelect } from '../fields'
import { columnOptions, Nested, ReadOnlyPart, type StageFormProps } from './stageFormParts'

// "Calculate columns": one card per calculated column. A calculation starts from a template, and
// its values are columns, numbers, now, or (two levels deep at most) another calculation.

type Kind = PlanExpression['kind']
type Composite = Exclude<Kind, 'column' | 'literal' | 'clock'>
const TEMPLATES: readonly Composite[] = ['duration', 'arithmetic', 'choice', 'coalesce', 'min', 'max']
/** How deep a calculation nests before the form shows it in words instead. */
const DEEPEST_FORM = 1
const isComposite = (kind: Kind): kind is Composite => (TEMPLATES as readonly string[]).includes(kind)

/** A template's starting expression, built on the columns the step reads. */
function seed(kind: Kind, columns: readonly PanelPlanColumn[]): PlanExpression {
  const first = (test: (column: PanelPlanColumn) => boolean) => columns.find(test)?.id ?? columns[0]?.id ?? ''
  const date = first(column => column.type === 'datetime')
  const number = first(column => column.type === 'number')
  switch (kind) {
    case 'column': return { kind, column: columns[0]?.id ?? '' }
    case 'literal': return { kind, value: 0 }
    case 'clock': return { kind, name: 'now' }
    case 'duration': return { kind, start: { kind: 'column', column: date }, end: { kind: 'clock', name: 'now' }, unit: 'days' }
    case 'arithmetic': return { kind, operator: 'add', left: { kind: 'column', column: number }, right: { kind: 'literal', value: 0 } }
    case 'choice': return { kind, column: first(column => column.type === 'enum' || column.type === 'boolean'), cases: {} }
    default: return { kind, values: [{ kind: 'column', column: number }, { kind: 'literal', value: 0 }] }
  }
}

/** The type a calculation produces, so the panel formats and compares its values as what they are. */
function resultType(expression: PlanExpression, columns: readonly PanelPlanColumn[]): 'number' | 'boolean' | 'text' | 'datetime' {
  const columnType = (id: string) => columns.find(column => column.id === id)?.type
  const scalar = (value: DataValue | undefined) => typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text'
  switch (expression.kind) {
    case 'column': { const type = columnType(expression.column); return type === 'number' || type === 'boolean' || type === 'datetime' ? type : 'text' }
    case 'literal': return scalar(expression.value)
    case 'clock': return 'datetime'
    case 'choice': {
      const types = new Set([...Object.values(expression.cases), ...expression.otherwise === undefined ? [] : [expression.otherwise]].map(scalar))
      return types.size === 1 ? [...types][0]! : 'text'
    }
    case 'coalesce': case 'min': case 'max': return resultType(expression.values[0]!, columns)
    default: return 'number'
  }
}

/** A calculation in words, for one nested deeper than the form draws. */
function expressionWords(expression: PlanExpression, columns: readonly PanelPlanColumn[]): string {
  const words = (part: PlanExpression) => expressionWords(part, columns)
  switch (expression.kind) {
    case 'column': return columns.find(column => column.id === expression.column)?.label ?? 'a missing column'
    case 'literal': return JSON.stringify(expression.value)
    case 'clock': return 'now'
    case 'arithmetic': return `(${words(expression.left)} ${ARITHMETIC_LABELS[expression.operator].toLowerCase()} ${words(expression.right)})`
    case 'duration': return `${DURATION_UNIT_LABELS[expression.unit].toLowerCase()} from ${words(expression.start)} to ${words(expression.end)}`
    case 'choice': return `a value for each ${words({ kind: 'column', column: expression.column })}`
    default: return `${EXPRESSION_LABELS[expression.kind].toLowerCase()} ${expression.values.map(words).join(', ')}`
  }
}

/** A typed value from an input: a number when it reads as one, otherwise the text. */
const scalar = (raw: string): DataValue => raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : raw

/** One calculation. At depth 0 it picks a template; deeper, it's a value: a column, a number, now, or
 *  a calculation of its own while there's room. */
function ExpressionField(props: { label: string; value: PlanExpression; columns: readonly PanelPlanColumn[]; depth: number; onChange: (value: PlanExpression) => void }) {
  const choice = (kind: Kind) => ({ value: kind, label: EXPRESSION_LABELS[kind] })
  const options = () => props.depth === 0
    ? [...TEMPLATES.map(choice), choice('column'), choice('literal'), choice('clock')]
    : [...columnOptions(props.columns, props.value.kind === 'column' ? props.value.column : undefined).map(option => ({ ...option, value: `column:${option.value}` })),
      { value: 'literal', label: 'A number' }, { value: 'clock', label: 'Now' }, ...props.depth <= DEEPEST_FORM ? TEMPLATES.map(choice) : []]
  const selected = () => props.depth > 0 && props.value.kind === 'column' ? `column:${props.value.column}` : props.value.kind
  const pick = (value: string) => {
    if (value === selected()) return
    props.onChange(value.startsWith('column:') ? { kind: 'column', column: value.slice('column:'.length) } : seed(value as Kind, props.columns))
  }
  const of = <K extends Kind>(kind: K) => props.value.kind === kind ? props.value as Extract<PlanExpression, { kind: K }> : undefined
  const tooDeep = () => props.depth > DEEPEST_FORM && isComposite(props.value.kind)
  // The sub-form below the picker. A memo of its own, so editing a value doesn't rebuild the form.
  const body = createMemo(() => tooDeep() ? 'words' : props.value.kind)
  const child = (label: string, value: PlanExpression, onChange: (value: PlanExpression) => void) =>
    <ExpressionField label={label} value={value} columns={props.columns} depth={props.depth + 1} onChange={onChange} />
  const list = () => props.value as Extract<PlanExpression, { kind: 'coalesce' | 'min' | 'max' }>

  return <Stack gap="row">
    <Show when={!tooDeep()} fallback={<ReadOnlyPart>{`${props.label}: ${expressionWords(props.value, props.columns)}.`}</ReadOnlyPart>}>
      <LabeledSelect label={props.label} value={selected()} options={options()} onChange={pick} />
    </Show>
    <Switch>
      <Match when={body() === 'column' && props.depth === 0 && of('column')}>{value => (
        <LabeledSelect label="Column" value={value().column} options={columnOptions(props.columns, value().column)} onChange={column => props.onChange({ kind: 'column', column })} />
      )}</Match>
      <Match when={body() === 'literal' && of('literal')}>{value => (
        <LabeledInput label={props.depth ? `Number for ${props.label.toLowerCase()}` : 'Value'} value={String(value().value ?? '')} onInput={raw => props.onChange({ kind: 'literal', value: scalar(raw) })} />
      )}</Match>
      <Match when={body() === 'duration' && of('duration')}>{value => <Nested>
        {child('From', value().start, start => props.onChange({ ...value(), start }))}
        {child('To', value().end, end => props.onChange({ ...value(), end }))}
        <LabeledSelect label="In" value={value().unit} options={(['minutes', 'hours', 'days', ...['ms', 's'].includes(value().unit) ? [value().unit] : []] as const).map(unit => ({ value: unit, label: DURATION_UNIT_LABELS[unit] }))}
          onChange={unit => props.onChange({ ...value(), unit: unit as Extract<PlanExpression, { kind: 'duration' }>['unit'] })} />
      </Nested>}</Match>
      <Match when={body() === 'arithmetic' && of('arithmetic')}>{value => <Nested>
        {child('First value', value().left, left => props.onChange({ ...value(), left }))}
        <LabeledSelect label="Operation" value={value().operator} options={Object.entries(ARITHMETIC_LABELS).map(([operator, label]) => ({ value: operator, label }))}
          onChange={operator => props.onChange({ ...value(), operator: operator as Extract<PlanExpression, { kind: 'arithmetic' }>['operator'] })} />
        {child('Second value', value().right, right => props.onChange({ ...value(), right }))}
      </Nested>}</Match>
      <Match when={body() === 'choice' && of('choice')}>{value => {
        const choices = () => props.columns.find(column => column.id === value().column)?.choices
          ?? (props.columns.find(column => column.id === value().column)?.type === 'boolean' ? [{ id: 'true', label: 'Yes' }, { id: 'false', label: 'No' }] : [])
        return <Nested>
          <LabeledSelect label="Choice column" value={value().column}
            options={columnOptions(props.columns.filter(column => column.type === 'enum' || column.type === 'boolean'), value().column)}
            onChange={column => props.onChange({ ...value(), column, cases: {} })} />
          <Index each={choices()}>{entry => <LabeledInput label={entry().label} value={String(value().cases[entry().id] ?? '')}
            onInput={raw => props.onChange({ ...value(), cases: { ...value().cases, [entry().id]: scalar(raw) } })} />}</Index>
          <LabeledInput label="Otherwise" value={String(value().otherwise ?? '')} onInput={raw => {
            const { otherwise: _previous, ...rest } = value()
            props.onChange(raw ? { ...rest, otherwise: scalar(raw) } : rest)
          }} />
        </Nested>
      }}</Match>
      <Match when={['coalesce', 'min', 'max'].includes(body())}><Nested>
        <Index each={list().values}>{(entry, index) => <Stack gap="row">
          {child(`Value ${index + 1}`, entry(), next => props.onChange({ ...list(), values: list().values.map((part, at) => at === index ? next : part) }))}
          <Show when={list().values.length > 2}><Button size="sm" variant="bare" onPress={() => props.onChange({ ...list(), values: list().values.filter((_part, at) => at !== index) })}>Remove value</Button></Show>
        </Stack>}</Index>
        <Button size="sm" disabled={list().values.length >= 8} onPress={() => props.onChange({ ...list(), values: [...list().values, seed('column', props.columns)] })}>Add value</Button>
      </Nested></Match>
    </Switch>
  </Stack>
}

export default function ComputeForm(props: StageFormProps<'compute'>) {
  type Calculated = StageFormProps<'compute'>['stage']['columns'][number]
  const edit = (index: number, update: (column: Calculated) => Calculated, options?: { coalesce?: boolean }) =>
    props.onChange({ ...props.stage, columns: props.stage.columns.map((column, at) => at === index ? update(column) : column) }, options)
  const add = () => {
    const label = 'Calculated value'
    const expression = seed('duration', props.columns)
    props.onChange({ ...props.stage, columns: [...props.stage.columns, { id: newColumnId(props.plan, label), label, type: resultType(expression, props.columns), expression }] })
  }
  return <Stack gap="row">
    <Index each={props.stage.columns}>{(column, index) => <Card><Stack gap="row">
      <LabeledInput label="Name" value={column().label} onInput={label => edit(index, entry => ({ ...entry, label }), { coalesce: true })} />
      <ExpressionField label="Calculation" value={column().expression} columns={props.columns} depth={0}
        onChange={expression => edit(index, entry => ({ ...entry, expression, type: resultType(expression, props.columns) }))} />
      <Show when={props.stage.columns.length > 1}>
        <Button size="sm" variant="bare" onPress={() => props.onChange({ ...props.stage, columns: props.stage.columns.filter((_entry, at) => at !== index) })}>Remove calculation</Button>
      </Show>
    </Stack></Card>}</Index>
    <Button size="sm" disabled={props.stage.columns.length >= 20} onPress={add}>Add calculation</Button>
  </Stack>
}
