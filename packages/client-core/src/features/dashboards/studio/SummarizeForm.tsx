import { Index, Show } from 'solid-js'
import { newColumnId } from '@acorn/dashboards-core/plan.ts'
import { BUCKET_LABELS, MEASURE_LABELS, PREVIOUS_CHANGE_LABELS, labelOptions } from '@acorn/dashboards-core/labels.ts'
import { describePredicate } from '@acorn/dashboards-core/outline.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { Button, Card, Checkbox, Field } from '../../../kit/components/primitives'
import { Fold } from '../../../kit/components/layout/Fold'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import { LabeledInput, LabeledSelect } from '../fields'
import { columnOptions, ConditionEditor, editableComparison, newComparison, ReadOnlyPart, viewerPointer, wholeNumber, type StageFormProps } from './stageFormParts'

// "Summarize rows": up to three columns to make one row per, the measures to calculate for each row,
// and the options that only apply when the rows are grouped by a date.

type Summary = StageFormProps<'summarize'>['stage']
type Measure = Summary['measures'][number]
type Group = Summary['by'][number]

/** The column type each measure reads, or none when it counts rows. */
const MEASURE_READS: Record<Measure['kind'], 'number' | 'datetime' | 'any' | undefined> = {
  count: undefined, 'count-where': undefined, sum: 'number', average: 'number', minimum: 'number', maximum: 'number', median: 'number',
  percentile: 'number', 'distinct-count': 'any', 'distinct-list': 'any', earliest: 'datetime', latest: 'datetime',
}
const TIME_BUCKETS = ['day', 'week', 'month'] as const
const isTimeGroup = (group: Group) => !!group.bucket && group.bucket !== 'value'
const editable = (predicate: DataPredicate) => editableComparison(predicate) ? predicate : undefined

export default function SummarizeForm(props: StageFormProps<'summarize'>) {
  const write = (update: (summary: Summary) => Summary, options?: { coalesce?: boolean }) => props.onChange(update(props.stage), options)
  const editGroup = (index: number, update: (group: Group) => Group) => write(summary => ({ ...summary, by: summary.by.map((group, at) => at === index ? update(group) : group) }))
  const editMeasure = (index: number, update: (measure: Measure) => Measure, options?: { coalesce?: boolean }) =>
    write(summary => ({ ...summary, measures: summary.measures.map((measure, at) => at === index ? update(measure) : measure) }), options)
  const columnType = (id: string | undefined) => props.columns.find(column => column.id === id)?.type
  const timeGrouped = () => props.stage.by.some(isTimeGroup)
  const viewer = (columnId: string | undefined) => viewerPointer(props.plan, props.sources, columnId)
  const splitColumns = () => props.columns.filter(column => column.type === 'enum' && column.choices?.length)

  const pickGroupColumn = (index: number, column: string) => editGroup(index, group => {
    const { bucket: _bucket, ...rest } = group
    return columnType(column) === 'datetime' ? { ...rest, column, bucket: isTimeGroup(group) ? group.bucket : 'day' } : { ...rest, column }
  })
  const pickMeasureKind = (index: number, kind: Measure['kind']) => editMeasure(index, measure => {
    const reads = MEASURE_READS[kind]
    const fits = (id: string | undefined) => !!id && (reads === 'any' || columnType(id) === reads)
    const { column: _column, percentile: _percentile, ...rest } = measure
    const column = fits(measure.column) ? measure.column : props.columns.find(entry => fits(entry.id))?.id
    return {
      ...rest, kind,
      ...(reads && column ? { column } : {}),
      ...(kind === 'percentile' ? { percentile: measure.percentile ?? 95 } : {}),
      ...(kind === 'count-where' && !measure.where ? { where: newComparison(props.columns[0], viewer(props.columns[0]?.id)) } : {}),
    }
  })
  const setWhere = (index: number, on: boolean) => editMeasure(index, measure => {
    const { where: _where, ...rest } = measure
    return on ? { ...rest, where: newComparison(props.columns[0], viewer(props.columns[0]?.id)) } : rest
  })
  const addMeasure = () => {
    const label = 'Count'
    write(summary => ({ ...summary, measures: [...summary.measures, { id: newColumnId(props.plan, label), label, kind: 'count' }] }))
  }
  const pickSplit = (column: string) => write(summary => {
    const { pivot: _pivot, ...rest } = summary
    if (!column) return rest
    return { ...rest, by: summary.by.some(group => group.column === column) ? summary.by : [...summary.by, { column }], pivot: { column, measure: summary.pivot?.measure ?? summary.measures[0]?.id ?? '' } }
  })

  /** A measure's condition: one comparison the form edits, or a stored predicate shown in words. */
  const condition = (index: number, measure: () => Measure) => <Show when={measure().where}>{where => (
    <Show when={editable(where())} fallback={<ReadOnlyPart>{`Only rows where ${describePredicate(props.plan, where())}.`}</ReadOnlyPart>}>
      {comparison => <ConditionEditor value={comparison()} columns={props.columns} viewer={viewer}
        onChange={(value, options) => editMeasure(index, entry => ({ ...entry, where: value }), options)} />}
    </Show>
  )}</Show>

  return <Stack gap="stack">
    <Field label="One row per" group><Stack gap="row">
      <Index each={props.stage.by}>{(group, index) => <Inline gap="inline" wrap>
        <LabeledSelect label="Column" value={group().column} options={columnOptions(props.columns, group().column)} onChange={column => pickGroupColumn(index, column)} />
        <Show when={columnType(group().column) === 'datetime'}>
          <LabeledSelect label="By" value={isTimeGroup(group()) ? group().bucket! : 'value'}
            options={[{ value: 'value', label: BUCKET_LABELS.value }, ...TIME_BUCKETS.map(bucket => ({ value: bucket, label: BUCKET_LABELS[bucket] }))]}
            onChange={bucket => editGroup(index, entry => ({ ...entry, bucket: bucket as Group['bucket'] }))} />
        </Show>
        <Button size="sm" variant="bare" onPress={() => write(summary => ({ ...summary, by: summary.by.filter((_entry, at) => at !== index) }))}>Remove</Button>
      </Inline>}</Index>
      <Show when={!props.stage.by.length}><Text emphasis="muted" wrap>No columns yet, so this step makes one row for everything.</Text></Show>
      <Inline><Button size="sm" disabled={props.stage.by.length >= 3 || !props.columns.length}
        onPress={() => write(summary => ({ ...summary, by: [...summary.by, { column: props.columns[0]!.id }] }))}>Add column</Button></Inline>
    </Stack></Field>

    <Field label="Measures" group><Stack gap="row">
      <Index each={props.stage.measures}>{(measure, index) => <Card><Stack gap="row">
        <LabeledInput label="Name" value={measure().label} onInput={label => editMeasure(index, entry => ({ ...entry, label }), { coalesce: true })} />
        <LabeledSelect label="Calculate" value={measure().kind} options={labelOptions(MEASURE_LABELS)} onChange={kind => pickMeasureKind(index, kind as Measure['kind'])} />
        <Show when={MEASURE_READS[measure().kind]}>{reads => <LabeledSelect label="Of" value={measure().column ?? ''}
          options={[...measure().column ? [] : [{ value: '', label: 'Choose a column' }],
            ...columnOptions(props.columns.filter(column => reads() === 'any' || column.type === reads()), measure().column)]}
          onChange={column => editMeasure(index, entry => ({ ...entry, column }))} />}</Show>
        <Show when={measure().kind === 'percentile'}>
          <LabeledInput label="Percentile" type="number" min={1} max={99} value={String(measure().percentile ?? '')}
            onInput={raw => editMeasure(index, entry => { const { percentile: _old, ...rest } = entry; const value = wholeNumber(raw); return value === undefined ? rest : { ...rest, percentile: value } }, { coalesce: true })} />
        </Show>
        <Show when={measure().kind === 'count-where'}>{condition(index, measure)}</Show>
        <Fold label="More options" level="sub">
          <Stack gap="row">
            <Show when={measure().kind !== 'count-where'}>
              <Checkbox label="Only count rows where" checked={!!measure().where} onChange={on => setWhere(index, on)} />
              {condition(index, measure)}
            </Show>
            <Checkbox label="Show as share of the total" checked={!!measure().share}
              onChange={share => editMeasure(index, entry => { const { share: _old, ...rest } = entry; return share ? { ...rest, share } : rest })} />
            <Show when={timeGrouped() || measure().previous}>
              <LabeledSelect label="Change from the previous period" value={measure().previous ?? ''} options={[{ value: '', label: "Don't show" }, ...labelOptions(PREVIOUS_CHANGE_LABELS)]}
                onChange={previous => editMeasure(index, entry => { const { previous: _old, ...rest } = entry; return previous ? { ...rest, previous: previous as NonNullable<Measure['previous']> } : rest })} />
            </Show>
          </Stack>
        </Fold>
        <Show when={props.stage.measures.length > 1}>
          <Inline><Button size="sm" variant="bare" onPress={() => write(summary => ({ ...summary, measures: summary.measures.filter((_entry, at) => at !== index) }))}>Remove measure</Button></Inline>
        </Show>
      </Stack></Card>}</Index>
      <Inline><Button size="sm" disabled={props.stage.measures.length >= 30} onPress={addMeasure}>Add measure</Button></Inline>
    </Stack></Field>

    <Show when={timeGrouped() || props.stage.fill}>
      <Checkbox label="Fill empty periods" checked={!!props.stage.fill}
        onChange={fill => write(summary => { const { fill: _old, ...rest } = summary; return fill ? { ...rest, fill } : rest })} />
    </Show>
    <Show when={splitColumns().length || props.stage.pivot}>
      <LabeledSelect label="Split into columns by" value={props.stage.pivot?.column ?? ''} options={[{ value: '', label: "Don't split" }, ...columnOptions(splitColumns(), props.stage.pivot?.column)]} onChange={pickSplit} />
      <Show when={props.stage.pivot}>{pivot => <LabeledSelect label="Measure to split" value={pivot().measure}
        options={props.stage.measures.map(measure => ({ value: measure.id, label: measure.label }))}
        onChange={measure => write(summary => ({ ...summary, pivot: { column: pivot().column, measure } }))} />}</Show>
    </Show>
  </Stack>
}
