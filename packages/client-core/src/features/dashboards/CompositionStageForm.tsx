import { For, Show } from 'solid-js'
import type { PanelPlan, PlanExpression } from '@acorn/protocol/dashboards.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { PANEL_CAPABILITIES } from '@acorn/dashboards-core/capabilities.ts'
import { Button, Checkbox, Input, Select } from '../../kit/components/primitives'
import { Stack } from '../../kit/components/layout/Stack'

type Stage = PanelPlan['stages'][number]
type Column = PanelPlan['columns'][number]
const fieldOptions = (columns: readonly Column[]) => columns.map(column => ({ value: column.id, label: column.label }))
const scalar = (value: string): string | number | boolean => value === 'true' ? true : value === 'false' ? false : value.trim() && Number.isFinite(Number(value)) ? Number(value) : value
const filterColumn = (where: Extract<DataPredicate, { kind: 'comparison' }>): string => {
  const address = where.left.address
  return address.from === 'item' ? address.pointer.slice(1) : ''
}
const filterValue = (where: Extract<DataPredicate, { kind: 'comparison' }>): string => {
  const address = where.right?.address
  return address?.from === 'literal' ? String(address.value ?? '') : ''
}
const seed = (kind: PlanExpression['kind'], first: string): PlanExpression => kind === 'column' ? { kind, column: first }
  : kind === 'literal' ? { kind, value: 0 } : kind === 'clock' ? { kind, name: 'now' }
  : kind === 'arithmetic' ? { kind, operator: 'add', left: { kind: 'column', column: first }, right: { kind: 'literal', value: 0 } }
  : kind === 'duration' ? { kind, start: { kind: 'column', column: first }, end: { kind: 'clock', name: 'now' }, unit: 'hours' }
  : kind === 'choice' ? { kind, column: first, cases: {} }
  : { kind, values: [{ kind: 'column', column: first }, { kind: 'literal', value: 0 }] }

function ExpressionForm(props: { value: PlanExpression; columns: readonly Column[]; onChange: (value: PlanExpression) => void }) {
  const first = () => props.columns[0]?.id ?? ''
  const of = <K extends PlanExpression['kind']>(kind: K): Extract<PlanExpression, { kind: K }> | undefined => props.value.kind === kind ? props.value as Extract<PlanExpression, { kind: K }> : undefined
  return <Stack gap="row">
    <Select label="Expression" size="sm" value={props.value.kind} options={['column', 'literal', 'clock', 'arithmetic', 'duration', 'coalesce', 'choice', 'min', 'max'].map(value => ({ value, label: value }))}
      onChange={kind => props.onChange(seed(kind as PlanExpression['kind'], first()))} />
    <Show when={of('column')}>{value => <Select label="Column" size="sm" value={value().column} options={fieldOptions(props.columns)} onChange={column => props.onChange({ kind: 'column', column })} />}</Show>
    <Show when={of('literal')}>{value => <Input label="Value" assist={false} value={String(value().value ?? '')} onInput={raw => props.onChange({ kind: 'literal', value: scalar(raw) })} />}</Show>
    <Show when={of('arithmetic')}>{value => <>
      <Select label="Operation" size="sm" value={value().operator} options={['add', 'subtract', 'multiply', 'divide'].map(item => ({ value: item, label: item }))} onChange={operator => props.onChange({ ...value(), operator: operator as 'add' | 'subtract' | 'multiply' | 'divide' })} />
      <ExpressionForm value={value().left} columns={props.columns} onChange={left => props.onChange({ ...value(), left })} />
      <ExpressionForm value={value().right} columns={props.columns} onChange={right => props.onChange({ ...value(), right })} />
    </>}</Show>
    <Show when={of('duration')}>{value => <>
      <ExpressionForm value={value().start} columns={props.columns} onChange={start => props.onChange({ ...value(), start })} />
      <ExpressionForm value={value().end} columns={props.columns} onChange={end => props.onChange({ ...value(), end })} />
      <Select label="Duration unit" size="sm" value={value().unit} options={['ms', 's', 'minutes', 'hours', 'days'].map(item => ({ value: item, label: item }))} onChange={unit => props.onChange({ ...value(), unit: unit as 'ms' | 's' | 'minutes' | 'hours' | 'days' })} />
    </>}</Show>
    <Show when={props.value.kind === 'coalesce' || props.value.kind === 'min' || props.value.kind === 'max' ? props.value as Extract<PlanExpression, { kind: 'coalesce' | 'min' | 'max' }> : undefined}>{value => <For each={value().values}>{(entry, index) => <ExpressionForm value={entry} columns={props.columns} onChange={updated => props.onChange({ ...value(), values: value().values.map((part, at) => at === index() ? updated : part) })} />}</For>}</Show>
    <Show when={of('choice')}>{value => <>
      <Select label="Choice column" size="sm" value={value().column} options={fieldOptions(props.columns.filter(column => column.type === 'enum' || column.type === 'boolean'))} onChange={column => props.onChange({ ...value(), column })} />
      <For each={props.columns.find(column => column.id === value().column)?.choices ?? [{ id: 'true', label: 'True' }, { id: 'false', label: 'False' }]}>{choice => <Input label={choice.label} assist={false} value={String(value().cases[choice.id] ?? '')} onInput={raw => props.onChange({ ...value(), cases: { ...value().cases, [choice.id]: scalar(raw) } })} />}</For>
      <Input label="Otherwise" assist={false} value={String(value().otherwise ?? '')} onInput={raw => props.onChange({ ...value(), otherwise: scalar(raw) })} />
    </>}</Show>
  </Stack>
}

export default function CompositionStageForm(props: { stage: Stage; columns: readonly Column[]; onChange: (stage: Stage) => void }) {
  const of = <K extends Stage['op']>(op: K): Extract<Stage, { op: K }> | undefined => props.stage.op === op ? props.stage as Extract<Stage, { op: K }> : undefined
  return <Stack gap="row">
    <Show when={of('compute')}>{compute => <>
      <For each={compute().columns}>{(column, index) => <Stack gap="row">
        <Input label="Result column ID" assist={false} value={column.id} onInput={id => props.onChange({ ...compute(), columns: compute().columns.map((item, at) => at === index() ? { ...item, id } : item) })} />
        <Input label="Label" assist={false} value={column.label} onInput={label => props.onChange({ ...compute(), columns: compute().columns.map((item, at) => at === index() ? { ...item, label } : item) })} />
        <ExpressionForm value={column.expression} columns={props.columns} onChange={expression => props.onChange({ ...compute(), columns: compute().columns.map((item, at) => at === index() ? { ...item, expression } : item) })} />
      </Stack>}</For>
      <Button size="sm" onPress={() => props.onChange({ ...compute(), columns: [...compute().columns, { id: `calculated${compute().columns.length}`, label: 'Calculated', expression: { kind: 'column', column: props.columns[0]?.id ?? '' } }] })}>Add calculation</Button>
    </>}</Show>
    <Show when={of('summarize')}>{summary => <>
      <For each={summary().by}>{(group, index) => <>
        <Select label={`Group ${index() + 1}`} size="sm" value={group.column} options={fieldOptions(props.columns)} onChange={column => props.onChange({ ...summary(), by: summary().by.map((item, at) => at === index() ? { ...item, column } : item) })} />
        <Show when={props.columns.find(column => column.id === group.column)?.type === 'datetime'}><Select label="Time bucket" size="sm" value={group.bucket ?? 'day'} options={['day', 'week', 'month'].map(value => ({ value, label: value }))} onChange={bucket => props.onChange({ ...summary(), by: summary().by.map((item, at) => at === index() ? { ...item, bucket: bucket as 'day' | 'week' | 'month' } : item) })} /></Show>
        <Button size="sm" variant="bare" onPress={() => props.onChange({ ...summary(), by: summary().by.filter((_item, at) => at !== index()) })}>Remove group</Button>
      </>}</For>
      <Button size="sm" disabled={summary().by.length >= 3} onPress={() => props.onChange({ ...summary(), by: [...summary().by, { column: props.columns[0]?.id ?? '' }] })}>Add group</Button>
      <For each={summary().measures}>{(measure, index) => <Stack gap="row">
        <Input label="Measure ID" assist={false} value={measure.id} onInput={id => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, id } : item) })} />
        <Input label="Measure label" assist={false} value={measure.label} onInput={label => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, label } : item) })} />
        <Select label="Measure" size="sm" value={measure.kind} options={PANEL_CAPABILITIES.measures.map(value => ({ value, label: value }))} onChange={kind => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, kind: kind as typeof measure.kind } : item) })} />
        <Select label="Value column" size="sm" value={measure.column ?? ''} options={[{ value: '', label: 'None' }, ...fieldOptions(props.columns)]} onChange={column => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, column: column || undefined } : item) })} />
        <Show when={measure.kind === 'percentile'}><Input label="Percentile 1–99" assist={false} value={String(measure.percentile ?? 95)} onInput={value => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, percentile: Number(value) } : item) })} /></Show>
        <Checkbox label="Filter this measure" checked={!!measure.where} onChange={checked => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, where: checked ? { kind: 'comparison', left: { address: { from: 'item', pointer: `/${props.columns[0]?.id ?? ''}` } }, operator: 'eq', right: { address: { from: 'literal', value: '' } } } : undefined } : item) })} />
        <Show when={measure.where?.kind === 'comparison' ? measure.where : undefined}>{where => <>
          <Select label="Filter column" size="sm" value={filterColumn(where())} options={fieldOptions(props.columns)} onChange={column => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, where: { ...where(), left: { address: { from: 'item', pointer: `/${column}` } } } } : item) })} />
          <Select label="Filter comparison" size="sm" value={where().operator} options={['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'present', 'missing'].map(value => ({ value, label: value }))} onChange={operator => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, where: { ...where(), operator: operator as 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'present' | 'missing' } } : item) })} />
          <Input label="Filter value" assist={false} value={filterValue(where())} onInput={raw => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, where: { ...where(), right: { address: { from: 'literal', value: scalar(raw) } } } } : item) })} />
        </>}</Show>
        <Checkbox label="Share of total" checked={!!measure.share} onChange={share => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, share } : item) })} />
        <Select label="Previous bucket change" size="sm" value={measure.previous ?? ''} options={[{ value: '', label: 'None' }, { value: 'amount', label: 'Amount' }, { value: 'ratio', label: 'Ratio' }]} onChange={previous => props.onChange({ ...summary(), measures: summary().measures.map((item, at) => at === index() ? { ...item, previous: previous ? previous as 'amount' | 'ratio' : undefined } : item) })} />
      </Stack>}</For>
      <Button size="sm" onPress={() => props.onChange({ ...summary(), measures: [...summary().measures, { id: `count${summary().measures.length}`, label: 'Count', kind: 'count' }] })}>Add measure</Button>
      <Checkbox label="Fill empty time buckets" checked={!!summary().fill} onChange={fill => props.onChange({ ...summary(), fill })} />
      <Select label="Pivot enum" size="sm" value={summary().pivot?.column ?? ''} options={[{ value: '', label: 'No pivot' }, ...fieldOptions(props.columns.filter(column => column.type === 'enum' && !!column.choices))]} onChange={column => props.onChange({ ...summary(), by: column && !summary().by.some(group => group.column === column) ? [...summary().by, { column }] : summary().by, pivot: column ? { column, measure: summary().measures[0]?.id ?? '' } : undefined })} />
      <Show when={summary().pivot}><Select label="Pivot measure" size="sm" value={summary().pivot?.measure ?? ''} options={summary().measures.map(measure => ({ value: measure.id, label: measure.label }))} onChange={measure => props.onChange({ ...summary(), pivot: { column: summary().pivot!.column, measure } })} /></Show>
    </>}</Show>
    <Show when={of('expand')}>{expand => <>
      <Select label="List column" size="sm" value={expand().column} options={fieldOptions(props.columns.filter(column => column.list))} onChange={column => props.onChange({ ...expand(), column })} />
      <Input label="Element column ID" assist={false} value={expand().output} onInput={output => props.onChange({ ...expand(), output })} />
      <Input label="Maximum per row" assist={false} value={String(expand().perRow)} onInput={value => props.onChange({ ...expand(), perRow: Number(value) })} />
    </>}</Show>
    <Show when={of('overlap')}>{overlap => <>
      <Select label="Start" size="sm" value={overlap().start} options={fieldOptions(props.columns.filter(column => column.type === 'datetime'))} onChange={start => props.onChange({ ...overlap(), start })} />
      <Select label="End" size="sm" value={overlap().end} options={fieldOptions(props.columns.filter(column => column.type === 'datetime'))} onChange={end => props.onChange({ ...overlap(), end })} />
      <Select label="Partition" size="sm" value={overlap().partition ?? ''} options={[{ value: '', label: 'All rows' }, ...fieldOptions(props.columns)]} onChange={partition => props.onChange({ ...overlap(), partition: partition || undefined })} />
      <Input label="Maximum pairs" assist={false} value={String(overlap().maxPairs)} onInput={value => props.onChange({ ...overlap(), maxPairs: Number(value) })} />
    </>}</Show>
  </Stack>
}
