import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { dashboardFields } from '@acorn/dashboards-core/projection'
import { describePanelPlan, outputPlanColumns, type DashboardRun } from '@acorn/dashboards-core/plan.ts'
import { PANEL_CAPABILITIES } from '@acorn/dashboards-core/capabilities.ts'
import {
  AGGREGATE_LABELS, BUCKET_LABELS, CHART_SHAPE_LABELS, COLUMN_TYPE_LABELS, OPERATOR_LABELS, RELATIVE_OFFSET_LABELS, SORT_DIRECTION_LABELS,
  SOURCE_ROLE_LABELS, TIME_MODE_LABELS, TONE_LABELS, VIEW_LABELS, WEEK_START_LABELS, labelOptions, operatorLabel,
} from '@acorn/dashboards-core/labels.ts'
import type { PlanPartKey } from '@acorn/dashboards-core/outline.ts'
import type { SourceQueryEditorState } from '../../dataSources/SourceQueryEditor'
import SourceQueryEditor from '../../dataSources/SourceQueryEditor'
import { Button, Card, Checkbox, Field } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import { availableContentPresentations } from '../../../host/registries/panes/contentLinks'
import CompositionStageForm from '../CompositionStageForm'
import EquivalenceForm from '../EquivalenceForm'
import KeepHistory from '../KeepHistory'
import WriteValueControls from '../WriteValueControls'
import { defaultPlanColumns, unbindMissingFields } from '../dashboardEditorModel'
import { LabeledInput, LabeledSelect } from '../fields'
import type { StudioChangeOptions } from './studioStore'

// The studio's inspector: one form per kind of plan part, keyed by the part's kind
// (docs/dashboards/mapping-and-editor.md § The generated editor). Each form is the one the editor's
// single long form drew for that part, moved here as it was.

/** What every inspector reads and writes. */
export type InspectorContext = {
  plan: () => PanelPlan
  change: (update: (current: PanelPlan) => PanelPlan, options?: StudioChangeOptions) => void
  select: (key: PlanPartKey) => void
  workspaceId: string
  run: () => DashboardRun | undefined
  sources: SourceTracking
  /** Refetches every query after a source starts keeping history. */
  refreshQueries: () => void
}

type Column = PanelPlan['columns'][number]
type Stage = PanelPlan['stages'][number]
type Comparison = Extract<DataPredicate, { kind: 'comparison' }>
type Presentation = 'route' | 'refPanel' | 'pane' | 'overlay' | 'external'
type InspectorProps = { context: InspectorContext; part: PlanPartKey }

const firstPredicate = (column: string): DataPredicate => ({
  kind: 'comparison', left: { address: { from: 'item', pointer: `/${column}` } }, operator: 'eq', right: { address: { from: 'literal', value: '' } },
})
const comparison = (predicate: DataPredicate): Comparison | undefined => predicate.kind === 'comparison' ? predicate : undefined
const filterColumn = (predicate: DataPredicate): string => {
  const address = comparison(predicate)?.left.address
  return address?.from === 'item' ? address.pointer.slice(1) : ''
}
const operand = (predicate: DataPredicate): string => {
  const right = comparison(predicate)?.right?.address
  return right?.from === 'literal' ? String(right.value ?? '') : ''
}
const filterValueMode = (predicate: DataPredicate): string => {
  const address = comparison(predicate)?.right?.address
  return address?.from === 'context' ? address.name === 'calendar' ? address.boundary : address.name : 'literal'
}
const filterOffset = (predicate: DataPredicate): string => {
  const address = comparison(predicate)?.right?.address
  return address?.from === 'context' && (address.name === 'now' || address.name === 'calendar') ? address.offset ?? '' : ''
}
/** Every zone this runtime knows, with the chosen one kept even when it does not. The same rule as
 *  the workflow schedule dialog's, which a plugin can't share with client-core. */
const timezoneOptions = (current: string) => {
  const zones = Intl.supportedValuesOf('timeZone')
  return (current && !zones.includes(current) ? [current, ...zones] : zones).map(zone => ({ value: zone, label: zone.replaceAll('_', ' ') }))
}
/** The preset offsets, keeping a stored one that isn't a preset under its own value. */
const offsetOptions = (current: string) => [
  { value: '', label: 'No offset' },
  ...(current && !(current in RELATIVE_OFFSET_LABELS) ? [{ value: current, label: current }] : []),
  ...labelOptions(RELATIVE_OFFSET_LABELS),
]
const presentationOptions = [{ value: 'route', label: 'Full page' }, { value: 'refPanel', label: 'Side panel' }, { value: 'pane', label: 'Task pane' }, { value: 'overlay', label: 'Overlay' }, { value: 'external', label: 'Browser' }]
const columnOptions = (plan: PanelPlan) => outputPlanColumns(plan).map(column => ({ value: column.id, label: column.label }))
const sourceLabel = (plan: PanelPlan, id: string): string => plan.sources.find(source => source.id === id)?.label ?? id

// ── Plan edits the outline's Add menu shares ─────────────────────────────────────────────────────

export const addSourceTo = (plan: PanelPlan, reference: QueryReference): PanelPlan =>
  ({ ...plan, sources: [...plan.sources, { id: crypto.randomUUID(), label: `Source ${plan.sources.length + 1}`, role: 'primary', reference }] })
export const addColumnTo = (plan: PanelPlan): PanelPlan =>
  ({ ...plan, columns: [...plan.columns, { id: `column_${crypto.randomUUID().replaceAll('-', '')}`, label: 'New column', type: 'text', bind: {} }] })
/** The plan with a new step for `op` at the end, or the plan unchanged when the step needs columns it lacks. */
export const addStageTo = (plan: PanelPlan, op: Stage['op']): PanelPlan => {
  const columns = outputPlanColumns(plan)
  const first = columns[0]?.id ?? ''
  const dates = columns.filter(column => column.type === 'datetime')
  const list = columns.find(column => column.list)
  const stage: Stage | undefined = op === 'filter' ? { op, where: firstPredicate(first) }
    : op === 'compute' ? { op, columns: [{ id: `computed${plan.stages.length}`, label: 'Calculated value', type: 'number', expression: { kind: 'column', column: first } }] }
    : op === 'summarize' ? { op, by: [], measures: [{ id: `count${plan.stages.length}`, label: 'Count', kind: 'count' }] }
    : op === 'expand' && list ? { op, column: list.id, output: `element${plan.stages.length}`, perRow: 100 }
    : op === 'overlap' && dates.length >= 2 ? { op, start: dates[0]!.id, end: dates[1]!.id, maxPairs: 5000 } : undefined
  return stage ? { ...plan, stages: [...plan.stages, stage] } : plan
}
export const removeSourceFrom = (plan: PanelPlan, id: string): PanelPlan => ({
  ...plan,
  sources: plan.sources.filter(source => source.id !== id),
  relations: plan.relations?.filter(relation => relation.from !== id && relation.to !== id),
  columns: plan.columns.map(column => { const { [id]: _removed, ...bind } = column.bind; return { ...column, bind } }),
})
export const removeColumnFrom = (plan: PanelPlan, id: string): PanelPlan => ({ ...plan, columns: plan.columns.filter(column => column.id !== id) })
export const removeStageFrom = (plan: PanelPlan, index: number): PanelPlan => ({ ...plan, stages: plan.stages.filter((_stage, at) => at !== index) })
/** Swaps a step with its neighbour, `by` -1 for up and 1 for down. Unchanged at either end. */
export const moveStageIn = (plan: PanelPlan, index: number, by: -1 | 1): PanelPlan => {
  const target = index + by
  if (target < 0 || target >= plan.stages.length) return plan
  const stages = [...plan.stages]
  ;[stages[index], stages[target]] = [stages[target]!, stages[index]!]
  return { ...plan, stages }
}

// ── Sources ────────────────────────────────────────────────────────────────────────────────────

export type SourceTracking = ReturnType<typeof createSourceTracking>

/** What each source's picker last reported, and the starter plans its description offers. The column
 *  forms read field lists from here, so every source's picker stays mounted while the studio is open. */
export function createSourceTracking(input: {
  change: InspectorContext['change']
  validate: (plan: PanelPlan) => Promise<{ problems: string[] }>
}) {
  const [states, setStates] = createSignal<Record<string, SourceQueryEditorState | undefined>>({})
  const [starters, setStarters] = createSignal<Record<string, PanelPlan[]>>({})
  // The source each slot last described. A switch passes through a report with no description,
  // so the previous report can't tell us what the columns were built from.
  const describedSources = new Map<string, string>()
  const report = (id: string, state: SourceQueryEditorState): void => {
    const priorRevision = states()[id]?.description?.revision
    setStates(current => ({ ...current, [id]: state }))
    if (!state.description || !state.query) return
    const describedSource = `${state.query.source.pluginId}/${state.query.source.sourceId}`
    const priorSource = describedSources.get(id)
    describedSources.set(id, describedSource)
    if (priorRevision !== state.description.revision) void Promise.all((state.description.starterPlans ?? []).flatMap(candidate => {
      const parsed = panelPlanSchema.safeParse(candidate)
      return parsed.success ? [input.validate(parsed.data).then(result => result.problems.length ? undefined : parsed.data).catch(() => undefined)] : []
    })).then(values => setStarters(current => ({ ...current, [id]: values.filter((value): value is PanelPlan => !!value) })))
    const available = dashboardFields(state.description)
    // Columns bound to the old source's fields would point at fields the new source doesn't have.
    const switched = priorSource !== undefined && priorSource !== describedSource
    input.change(current => {
      const source = current.sources.find(entry => entry.id === id)
      if (!source) return current
      const label = state.source?.name ?? source.label
      const sources = current.sources.map(entry => entry.id === id ? { ...entry, label } : entry)
      if (switched && current.sources.length > 1) return { ...current, sources, columns: unbindMissingFields(current.columns, id, available) }
      if (current.sources.length !== 1 || (current.columns.length && !switched)) return JSON.stringify(sources) === JSON.stringify(current.sources) ? current : { ...current, sources }
      return { ...current, sources, columns: defaultPlanColumns(id, available) }
    }, { derived: true })
  }
  return { states, starters, report }
}

export function SourceInspector(props: InspectorProps) {
  const context = props.context
  const id = () => props.part.slice('source:'.length)
  const source = () => context.plan().sources.find(entry => entry.id === id())
  const state = () => context.sources.states()[id()]
  const setReference = (reference: QueryReference | undefined): void => context.change(current => reference
    ? { ...current, sources: current.sources.map(entry => entry.id === id() ? { ...entry, reference } : entry) }
    : removeSourceFrom(current, id()))
  const starterPlans = () => context.sources.starters()[id()] ?? []
  return <Show when={source()}>{current => <Stack gap="row">
    <SourceQueryEditor workspaceId={context.workspaceId} value={current().reference} hideAuthoring hideConditions hidePreview pickSourceAccount
      onChange={setReference} onStateChange={next => context.sources.report(id(), next)} />
    <LabeledSelect label="What this source does" value={current().role} options={labelOptions(SOURCE_ROLE_LABELS)}
      onChange={role => context.change(plan => ({ ...plan, sources: plan.sources.map(entry => entry.id === id() ? { ...entry, role: role as typeof entry.role } : entry) }))} />
    <Show when={state()?.query && state()?.description && state()?.source}>
      <KeepHistory query={state()!.query!} description={state()!.description!} sourceName={state()!.source!.name} onCreated={context.refreshQueries} />
    </Show>
    <Show when={starterPlans().length}><Field label="Start from" group><Inline gap="inline" wrap>
      <For each={starterPlans()}>{starter => <Button size="sm" tip={describePanelPlan(starter)[0]} onPress={() => context.change(() => starter)}>{starter.title}</Button>}</For>
    </Inline></Field></Show>
    <Button size="sm" variant="ghost" onPress={() => setReference(undefined)}>Remove source</Button>
  </Stack>}</Show>
}

/** The picker for a source the plan doesn't have yet. The source joins the plan when one is picked:
 *  a placeholder source made the preview report it unavailable before anything was chosen. */
export function NewSourceInspector(props: { workspaceId: string; onPick: (reference: QueryReference) => void; onCancel?: () => void }) {
  return <Stack gap="row">
    <SourceQueryEditor workspaceId={props.workspaceId} hideAuthoring hideConditions hidePreview pickSourceAccount
      onChange={reference => reference && props.onPick(reference)} />
    <Show when={props.onCancel}>{cancel => <Button size="sm" variant="bare" onPress={cancel()}>Cancel</Button>}</Show>
  </Stack>
}

function RelationsInspector(props: InspectorProps) {
  const context = props.context
  const plan = context.plan
  const states = context.sources.states
  const addDeclaredRelation = (from: string, to: string, declared: NonNullable<DataSourceDescription['relations']>[number]): void => {
    const output = declared.cardinality === 'one-to-many' ? `${to}Children` : undefined
    context.change(current => ({ ...current,
      relations: [...current.relations ?? [], { id: declared.id, from, to, kind: declared.kind, cardinality: declared.cardinality,
        keys: declared.keys, unmatched: 'keep', maxMatches: 5000, ...(output ? { output } : {}) }],
      columns: output && !current.columns.some(column => column.id === output)
        ? [...current.columns, { id: output, label: declared.label, type: 'text', list: true, bind: {} }] : current.columns,
    }))
  }
  return <Stack gap="row">
    <EquivalenceForm sources={plan().sources} columns={plan().columns} onAdd={relation => context.change(current => ({ ...current, relations: [...current.relations ?? [], relation] }))} />
    <For each={plan().relations ?? []}>{(relation, index) => <Card><Stack gap="row">
      <Text>{`${sourceLabel(plan(), relation.from)} ${relation.kind.replaceAll('-', ' ')} ${sourceLabel(plan(), relation.to)}`}</Text>
      <LabeledSelect label="Unmatched rows" value={relation.unmatched} options={[{ value: 'keep', label: 'Keep' }, { value: 'drop', label: 'Drop' }]}
        onChange={unmatched => context.change(current => ({ ...current, relations: current.relations?.map((entry, at) => at === index() ? { ...entry, unmatched: unmatched as 'keep' | 'drop' } : entry) }))} />
      <Button size="sm" variant="bare" onPress={() => context.change(current => ({ ...current, relations: current.relations?.filter((_entry, at) => at !== index()) }))}>Remove relation</Button>
    </Stack></Card>}</For>
    <For each={plan().sources}>{from => <For each={states()[from.id]?.description?.relations ?? []}>{declared => <For each={plan().sources.filter(to => to.id !== from.id && states()[to.id]?.source?.pluginId === declared.target.pluginId && states()[to.id]?.source?.sourceId === declared.target.sourceId)}>{to => <Button size="sm" disabled={(plan().relations ?? []).some(relation => relation.id === declared.id && relation.from === from.id && relation.to === to.id)} onPress={() => addDeclaredRelation(from.id, to.id, declared)}>{`Add ${declared.label}: ${from.label} to ${to.label}`}</Button>}</For>}</For>}</For>
  </Stack>
}

// ── Columns ────────────────────────────────────────────────────────────────────────────────────

function ColumnCard(props: { context: InspectorContext; column: Column }) {
  const context = props.context
  const plan = context.plan
  const states = context.sources.states
  const column = () => props.column
  const editColumn = (update: (column: Column) => Column, options?: StudioChangeOptions): void =>
    context.change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column().id ? update(entry) : entry) }), options)
  const editChoice = (index: number, update: (choice: NonNullable<Column['choices']>[number]) => NonNullable<Column['choices']>[number], options?: StudioChangeOptions): void =>
    editColumn(entry => ({ ...entry, choices: entry.choices?.map((choice, at) => at === index ? update(choice) : choice) }), options)
  const bindColumn = (sourceId: string, pointer: string): void => editColumn(entry => {
    const bind = { ...entry.bind }
    if (pointer) bind[sourceId] = { field: pointer }
    else delete bind[sourceId]
    return { ...entry, bind }
  })
  const suggestedBinding = (sourceId: string): { pointer: string; name: string } | undefined => {
    if (column().bind[sourceId]) return undefined
    const description = states()[sourceId]?.description
    if (!description) return undefined
    const fields = dashboardFields(description)
    const match = fields.find(field => field.type === column().type && field.name.toLowerCase() === column().label.toLowerCase())
      ?? fields.find(field => field.type === column().type && field.role === column().id)
    return match ? { pointer: match.id, name: match.name } : undefined
  }
  const mapChoice = (sourceId: string, valueId: string, choiceId: string): void => editColumn(entry => {
    const binding = entry.bind[sourceId]
    if (!binding || !('field' in binding)) return entry
    const values = Object.fromEntries(Object.entries(binding.values ?? {}).map(([id, sourceValues]) => [id, sourceValues.filter(value => value !== valueId)]))
    if (choiceId) values[choiceId] = [...(values[choiceId] ?? []), valueId]
    return { ...entry, bind: { ...entry.bind, [sourceId]: { ...binding, values } } }
  })
  return <Card><Stack gap="row">
    <LabeledInput label="Column name" value={column().label} onInput={label => editColumn(entry => ({ ...entry, label }), { coalesce: true })} />
    <LabeledSelect label="Type" value={column().type ?? 'text'} options={labelOptions(COLUMN_TYPE_LABELS)} onChange={type => editColumn(entry => ({ ...entry, type: type as NonNullable<Column['type']> }))} />
    <Show when={plan().relations?.some(relation => relation.kind === 'equivalence')}><LabeledSelect label="Preferred source for equivalent records" value={column().precedence?.[0] ?? ''}
      options={[{ value: '', label: 'First available' }, ...plan().sources.filter(source => source.role === 'primary').map(source => ({ value: source.id, label: source.label }))]}
      onChange={sourceId => editColumn(entry => ({ ...entry, precedence: sourceId ? [sourceId] : undefined }))} /></Show>
    <Checkbox label="List of values" checked={!!column().list} onChange={list => editColumn(entry => ({ ...entry, list }))} />
    <Show when={column().type === 'number'}><LabeledInput label="Fixed unit (currency, percent, ms, s, bytes)" value={typeof column().unit === 'string' ? column().unit as string : ''} onInput={unit => editColumn(entry => ({ ...entry, unit: unit || undefined }), { coalesce: true })} />
      <LabeledSelect label="Or unit from column" value={(() => { const unit = column().unit; return typeof unit === 'object' ? unit.column : '' })()} options={[{ value: '', label: 'Fixed unit' }, ...plan().columns.filter(entry => entry.id !== column().id).map(entry => ({ value: entry.id, label: entry.label }))]} onChange={unitColumn => editColumn(entry => ({ ...entry, unit: unitColumn ? { column: unitColumn } : undefined }))} /></Show>
    <Show when={column().type === 'datetime'}><LabeledSelect label="Date precision" value={column().precision ?? 'instant'} options={[{ value: 'instant', label: 'Instant' }, { value: 'day', label: 'Calendar day' }]} onChange={precision => editColumn(entry => ({ ...entry, precision: precision as 'instant' | 'day' }))} /></Show>
    <Show when={column().type === 'enum'}><LabeledSelect label="New values" value={column().unmatched ?? 'catch-all'} options={[{ value: 'catch-all', label: 'Show unmatched' }, { value: 'hidden', label: 'Hide unmatched' }]} onChange={unmatched => editColumn(entry => ({ ...entry, unmatched: unmatched as 'catch-all' | 'hidden' }))} />
      <For each={column().choices ?? []}>{(choice, index) => <Inline gap="inline" wrap>
        <LabeledInput label="Choice name" value={choice.label} onInput={label => editChoice(index(), value => ({ ...value, label }), { coalesce: true })} />
        <LabeledSelect label="Colour" value={choice.tone ?? 'muted'} options={labelOptions(TONE_LABELS)} onChange={tone => editChoice(index(), value => ({ ...value, tone: tone as NonNullable<typeof choice.tone> }))} />
        <LabeledInput label="Order" value={String(choice.rank ?? '')} onInput={rank => editChoice(index(), value => ({ ...value, rank: rank ? Number(rank) : undefined }), { coalesce: true })} />
        <WriteValueControls column={column()} choice={choice} sources={plan().sources}
          descriptions={Object.fromEntries(Object.entries(states()).map(([id, state]) => [id, state?.description]))}
          onChange={(sourceId, value, present) => editChoice(index(), candidate => {
            const writeValues = { ...candidate.writeValues }
            if (present) writeValues[sourceId] = value!
            else delete writeValues[sourceId]
            return { ...candidate, writeValues }
          })} />
      </Inline>}</For>
      <Button size="sm" onPress={() => editColumn(entry => ({ ...entry, choices: [...(entry.choices ?? []), { id: crypto.randomUUID(), label: 'New choice' }] }))}>Add choice</Button>
    </Show>
    <For each={plan().sources}>{source => <Stack gap="row">
      <LabeledSelect label={`From ${source.label}`}
        value={'field' in (column().bind[source.id] ?? {}) ? (column().bind[source.id] as { field: string }).field : ''}
        options={[{ value: '', label: 'No binding' }, ...((() => { const binding = column().bind[source.id]; return binding && 'field' in binding && !states()[source.id]?.description?.fields.some(field => field.pointer === binding.field) ? [{ value: binding.field, label: `Missing field ${binding.field} · rebind` }] : [] })()), ...(states()[source.id]?.description?.fields ?? []).map(field => ({ value: field.pointer, label: field.label }))]}
        onChange={pointer => bindColumn(source.id, pointer)} />
      <Show when={suggestedBinding(source.id)}>{suggestion => <Button size="sm" variant="bare" onPress={() => bindColumn(source.id, suggestion().pointer)}>{`Bind suggested ${suggestion().name}`}</Button>}</Show>
      <Show when={column().type === 'enum' && 'field' in (column().bind[source.id] ?? {})}>
        <For each={(() => {
          const binding = column().bind[source.id]
          const field = binding && 'field' in binding ? states()[source.id]?.description?.fields.find(item => item.pointer === binding.field) : undefined
          return field?.choices?.kind === 'static' ? field.choices.values : []
        })()}>{value => <LabeledSelect label={`Map ${value.label}`}
          value={(() => { const binding = column().bind[source.id]; return binding && 'field' in binding ? Object.entries(binding.values ?? {}).find(([, ids]) => ids.includes(value.id))?.[0] ?? '' : '' })()}
          options={[{ value: '', label: 'Unmatched' }, ...(column().choices ?? []).map(choice => ({ value: choice.id, label: choice.label }))]}
          onChange={choiceId => mapChoice(source.id, value.id, choiceId)} />}</For>
      </Show>
    </Stack>}</For>
    <Button size="sm" variant="bare" onPress={() => context.change(current => removeColumnFrom(current, column().id))}>Remove column</Button>
  </Stack></Card>
}

function ColumnsInspector(props: InspectorProps) {
  const context = props.context
  return <Stack gap="row">
    <For each={context.plan().columns}>{column => <ColumnCard context={context} column={column} />}</For>
    <Button size="sm" onPress={() => context.change(addColumnTo)}>Add column</Button>
  </Stack>
}

function ColumnInspector(props: InspectorProps) {
  const column = () => props.context.plan().columns.find(entry => `column:${entry.id}` === props.part)
  return <Show when={column()}>{current => <ColumnCard context={props.context} column={current()} />}</Show>
}

// ── Steps ──────────────────────────────────────────────────────────────────────────────────────

function StageInspector(props: InspectorProps) {
  const context = props.context
  const plan = context.plan
  const index = () => Number(props.part.slice('stage:'.length))
  const stage = () => plan().stages[index()]
  const editFilter = (changes: { column?: string; operator?: Comparison['operator']; value?: string }, options?: StudioChangeOptions): void => context.change(current => ({
    ...current, stages: current.stages.map((entry, at) => {
      if (at !== index() || entry.op !== 'filter') return entry
      const old = comparison(entry.where)
      const column = changes.column ?? (old?.left.address.from === 'item' ? old.left.address.pointer.slice(1) : current.columns[0]?.id ?? '')
      const operator = changes.operator ?? old?.operator ?? 'eq'
      const raw = changes.value ?? operand(entry.where)
      const type = current.columns.find(item => item.id === column)?.type
      const value = operator === 'in' ? raw.split(',').map(item => item.trim()).filter(Boolean)
        : type === 'number' && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw)
          : type === 'boolean' && ['true', 'false'].includes(raw.toLowerCase()) ? raw.toLowerCase() === 'true' : raw
      return { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: `/${column}` } }, operator,
        ...(['missing', 'present'].includes(operator) ? {} : { right: { address: { from: 'literal', value } } }),
      } }
    }),
  }), options)
  const viewerPointer = (columnId: string): string | undefined => {
    if (plan().sources.length !== 1) return undefined
    const source = plan().sources[0]!
    const binding = plan().columns.find(column => column.id === columnId)?.bind[source.id]
    return binding && 'field' in binding ? context.sources.states()[source.id]?.description?.fields.find(field => field.pointer === binding.field)?.viewerMatch : undefined
  }
  const editFilterContext = (mode: string): void => context.change(current => ({
    ...current, stages: current.stages.map((entry, at) => {
      if (at !== index() || entry.op !== 'filter' || entry.where.kind !== 'comparison') return entry
      const address = mode === 'viewer' ? { from: 'context' as const, name: 'viewer' as const, pointer: viewerPointer(filterColumn(entry.where)) ?? '/login' }
        : mode === 'now' ? { from: 'context' as const, name: 'now' as const, offset: '-P7D' }
          : mode === 'literal' ? { from: 'literal' as const, value: '' }
            : { from: 'context' as const, name: 'calendar' as const, boundary: mode as 'startOfDay' | 'startOfWeek' | 'startOfMonth' }
      return { ...entry, where: { ...entry.where, right: { address } } }
    }),
  }))
  const editFilterOffset = (offset: string): void => context.change(current => ({
    ...current, stages: current.stages.map((entry, at) => {
      if (at !== index() || entry.op !== 'filter' || entry.where.kind !== 'comparison' || entry.where.right?.address.from !== 'context') return entry
      const address = entry.where.right.address
      if (address.name !== 'now' && address.name !== 'calendar') return entry
      const { offset: _previous, ...withoutOffset } = address
      return { ...entry, where: { ...entry.where, right: { address: offset ? { ...withoutOffset, offset } : withoutOffset } } }
    }),
  }))
  return <Show when={stage()}>{current => <Stack gap="row">
    <Show when={current().op === 'filter' ? current() as Extract<Stage, { op: 'filter' }> : undefined}>{filter => {
      const columnType = () => plan().columns.find(column => column.id === filterColumn(filter().where))?.type
      return <>
        <LabeledSelect label="Column" value={filterColumn(filter().where)}
          options={plan().columns.map(column => ({ value: column.id, label: column.label }))} onChange={column => editFilter({ column })} />
        <LabeledSelect label="Comparison" value={comparison(filter().where)?.operator ?? 'eq'}
          options={(Object.keys(OPERATOR_LABELS) as Comparison['operator'][]).map(value => ({ value, label: operatorLabel(value, columnType()) }))}
          onChange={operator => editFilter({ operator: operator as Comparison['operator'] })} />
        <Show when={!['missing', 'present'].includes(comparison(filter().where)?.operator ?? '')}>
          <Show when={columnType() === 'datetime' || columnType() === 'person'}>
            <LabeledSelect label="Compare with" value={filterValueMode(filter().where)} options={[
              { value: 'literal', label: 'A fixed value' },
              ...(viewerPointer(filterColumn(filter().where)) ? [{ value: 'viewer', label: 'You' }] : columnType() === 'person' ? [] : [
                { value: 'now', label: 'Relative to now' }, { value: 'startOfDay', label: 'Start of today' },
                { value: 'startOfWeek', label: 'Start of this week' }, { value: 'startOfMonth', label: 'Start of this month' },
              ]),
            ]} onChange={editFilterContext} />
          </Show>
          <Show when={filterValueMode(filter().where) === 'literal'}><LabeledInput label="Value" value={operand(filter().where)} onInput={value => editFilter({ value }, { coalesce: true })} /></Show>
          <Show when={['now', 'startOfDay', 'startOfWeek', 'startOfMonth'].includes(filterValueMode(filter().where))}>
            <LabeledSelect label="Offset" value={filterOffset(filter().where)} options={offsetOptions(filterOffset(filter().where))} onChange={editFilterOffset} />
          </Show>
        </Show>
      </>
    }}</Show>
    <Show when={current().op !== 'filter'}><CompositionStageForm stage={current()} columns={plan().columns}
      onChange={next => context.change(plan => ({ ...plan, stages: plan.stages.map((entry, at) => at === index() ? next : entry) }))} /></Show>
    <Button size="sm" variant="bare" disabled={index() === 0} onPress={() => { context.change(plan => moveStageIn(plan, index(), -1)); context.select(`stage:${index() - 1}`) }}>Move up</Button>
    <Button size="sm" variant="bare" onPress={() => context.change(plan => removeStageFrom(plan, index()))}>Remove step</Button>
  </Stack>}</Show>
}

// ── Arrange, look, behaviour, settings ───────────────────────────────────────────────────────────

function ArrangeInspector(props: InspectorProps) {
  const { change, plan } = props.context
  return <Stack gap="row">
    <LabeledSelect label="Sort by" value={plan().sort?.[0]?.column ?? ''} options={[{ value: '', label: 'No sort' }, ...columnOptions(plan())]} onChange={column => change(current => ({ ...current, sort: column ? [{ column, direction: current.sort?.[0]?.direction ?? 'asc' }] : [] }))} />
    <Show when={plan().sort?.[0]}><LabeledSelect label="Sort order" value={plan().sort?.[0]?.direction ?? 'asc'} options={labelOptions(SORT_DIRECTION_LABELS)} onChange={direction => change(current => ({ ...current, sort: current.sort?.[0] ? [{ ...current.sort[0], direction: direction as 'asc' | 'desc' }] : [] }))} /></Show>
    <LabeledSelect label="Group by" value={plan().group?.[0]?.column ?? ''} options={[{ value: '', label: 'No grouping' }, ...columnOptions(plan())]} onChange={column => change(current => ({ ...current, group: column ? [{ column, bucket: 'value' }] : [] }))} />
    <Show when={plan().group?.[0]}><LabeledSelect label="Group into" value={plan().group?.[0]?.bucket ?? 'value'} options={labelOptions(BUCKET_LABELS)} onChange={bucket => change(current => ({ ...current, group: current.group?.[0] ? [{ ...current.group[0], bucket: bucket as NonNullable<PanelPlan['group']>[number]['bucket'] }] : [] }))} /></Show>
    <LabeledInput label="Show at most" value={String(plan().limit ?? '')} onInput={value => change(current => ({ ...current, limit: value ? Number(value) : undefined }), { coalesce: true })} />
  </Stack>
}

function LookInspector(props: InspectorProps) {
  const { change, plan } = props.context
  const viewHas = (option: string): boolean => (PANEL_CAPABILITIES.views[plan().view.kind].options as readonly string[]).includes(option)
  return <Stack gap="row">
    <LabeledInput label="Panel title" value={plan().title} onInput={title => change(current => ({ ...current, title }), { coalesce: true })} />
    <LabeledSelect label="View" value={plan().view.kind} options={labelOptions(VIEW_LABELS)} onChange={kind => change(current => { const summary = [...current.stages].reverse().find(stage => stage.op === 'summarize'); return { ...current, view: { ...current.view, kind: kind as PanelPlan['view']['kind'], ...(summary?.op === 'summarize' && (kind === 'stat' || kind === 'chart') ? { aggregate: 'sum' as const, field: summary.measures[0]?.id, ...(kind === 'chart' ? { x: summary.by[0]?.column } : {}) } : {}) } } })} />
    <Show when={viewHas('aggregate')}><LabeledSelect label="Calculate" value={plan().view.aggregate ?? 'count'} options={labelOptions(AGGREGATE_LABELS)} onChange={aggregate => change(current => ({ ...current, view: { ...current.view, aggregate: aggregate as NonNullable<PanelPlan['view']['aggregate']> } }))} /></Show>
    <For each={([['field', 'Value'], ['x', 'Across'], ['series', 'Split by']] as const).filter(([key]) => viewHas(key))}>{([key, label]) => <LabeledSelect label={label} value={plan().view[key] ?? ''} options={[{ value: '', label: 'None' }, ...columnOptions(plan())]} onChange={value => change(current => ({ ...current, view: { ...current.view, [key]: value || undefined } }))} />}</For>
    <Show when={viewHas('shape')}><LabeledSelect label="Chart shape" value={plan().view.shape ?? 'bar'} options={labelOptions(CHART_SHAPE_LABELS)} onChange={shape => change(current => ({ ...current, view: { ...current.view, shape: shape as 'bar' | 'line' } }))} /></Show>
    <Show when={viewHas('trend')}><LabeledSelect label="Trend" value={plan().view.trend ?? ''} options={[{ value: '', label: 'None' }, { value: 'history', label: 'History' }, { value: 'activity', label: 'Activity' }]} onChange={trend => change(current => ({ ...current, view: { ...current.view, trend: trend ? trend as 'history' | 'activity' : undefined } }))} /></Show>
    <Show when={viewHas('compare')}><LabeledSelect label="Compare with" value={plan().view.compare ?? ''} options={[{ value: '', label: 'Nothing' }, { value: 'day', label: 'The day before' }, { value: 'week', label: 'The week before' }]} onChange={compare => change(current => ({ ...current, view: { ...current.view, compare: compare ? compare as 'day' | 'week' : undefined } }))} /></Show>
    <Show when={viewHas('good')}><LabeledSelect label="Good direction" value={plan().view.good ?? ''} options={[{ value: '', label: 'Neutral' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]} onChange={good => change(current => ({ ...current, view: { ...current.view, good: good ? good as 'up' | 'down' : undefined } }))} /></Show>
  </Stack>
}

function BehaviourInspector(props: InspectorProps) {
  const { change, plan, run } = props.context
  const editButtons = (update: (buttons: NonNullable<PanelPlan['actions']>['buttons']) => NonNullable<PanelPlan['actions']>['buttons'], options?: StudioChangeOptions): void =>
    change(current => ({ ...current, actions: { press: current.actions?.press, buttons: update(current.actions?.buttons ?? []) } }), options)
  const pressPresentations = createMemo(() => {
    const selected = plan().actions?.press
    if (!selected) return []
    if (selected.kind === 'task') return run()?.rows.some(row => row.taskId) ? ['pane', 'route'] : []
    const choices = (run()?.rows ?? []).flatMap(row => selected.kind === 'link'
      ? (() => { const value = row.values[selected.column ?? '']; return typeof value === 'string' ? availableContentPresentations({ href: value, taskId: row.taskId }) : [] })()
      : row.target ? availableContentPresentations({ kind: row.target.kind, item: row.target.item, taskId: row.taskId })
        : row.action?.verb === 'openUrl' ? availableContentPresentations({ href: row.action.url, taskId: row.taskId }) : [])
    return [...new Set(choices)]
  })
  const full = () => (plan().actions?.buttons.length ?? 0) >= 3
  return <Stack gap="stack">
    <Field label="When a row is pressed" group><Stack gap="row">
      <LabeledSelect label="Open" value={plan().actions?.press?.kind ?? ''}
        options={[{ value: '', label: 'Record default' },
          ...(run()?.rows.some(row => !!row.action || !!row.target) ? [{ value: 'record', label: 'Source record' }] : []),
          ...(run()?.rows.some(row => !!row.taskId) ? [{ value: 'task', label: 'Its task' }] : []),
          ...(plan().columns.some(column => column.type === 'link') ? [{ value: 'link', label: 'Link column' }] : [])]}
        onChange={kind => change(current => ({ ...current, actions: {
          buttons: current.actions?.buttons ?? [],
          ...(kind ? { press: { kind: kind as 'record' | 'task' | 'link', prefer: kind === 'task' ? 'pane' : 'refPanel',
            ...(kind === 'link' ? { column: current.columns.find(column => column.type === 'link')?.id } : {}) } } : {}),
        } }))} />
      <Show when={plan().actions?.press} keyed>{press => <>
        <Show when={press.kind === 'link'}><LabeledSelect label="Link column" value={press.column ?? ''}
          options={plan().columns.filter(column => column.type === 'link').map(column => ({ value: column.id, label: column.label }))}
          onChange={column => change(current => ({ ...current, actions: { buttons: current.actions?.buttons ?? [], press: { ...current.actions!.press!, column } } }))} /></Show>
        <LabeledSelect label="Open in" value={press.prefer}
          options={presentationOptions.filter(option => pressPresentations().includes(option.value))}
          onChange={prefer => change(current => ({ ...current, actions: { buttons: current.actions?.buttons ?? [], press: { ...current.actions!.press!, prefer: prefer as Presentation } } }))} />
      </>}</Show>
    </Stack></Field>
    <Field label="Row buttons" group><Stack gap="row">
      <For each={plan().actions?.buttons ?? []}>{(button, index) => <Card><Stack gap="row">
        <LabeledInput label="Button label" value={button.label} onInput={label => editButtons(buttons => buttons.map((entry, at) => at === index() ? { ...entry, label } : entry), { coalesce: true })} />
        <LabeledInput label="Icon (optional)" value={button.icon ?? ''} onInput={icon => editButtons(buttons => buttons.map((entry, at) => at === index() ? { ...entry, icon: icon || undefined } : entry), { coalesce: true })} />
        <Show when={button.kind === 'open'}><>
          <LabeledSelect label="Opens" value={button.kind === 'open' ? button.reference.kind === 'link' ? `link:${button.reference.column ?? ''}` : button.reference.kind : 'record'}
            options={[{ value: 'record', label: 'Source record' }, { value: 'task', label: 'Its task' }, ...plan().columns.filter(column => column.type === 'link').map(column => ({ value: `link:${column.id}`, label: column.label }))]}
            onChange={value => editButtons(buttons => buttons.map((entry, at) => at === index() && entry.kind === 'open' ? { ...entry, reference: value.startsWith('link:') ? { kind: 'link', column: value.slice(5), prefer: entry.reference.prefer } : { kind: value as 'record' | 'task', prefer: entry.reference.prefer } } : entry))} />
          <LabeledSelect label="Open in" value={button.kind === 'open' ? button.reference.prefer : 'refPanel'} options={presentationOptions}
            onChange={prefer => editButtons(buttons => buttons.map((entry, at) => at === index() && entry.kind === 'open' ? { ...entry, reference: { ...entry.reference, prefer: prefer as Presentation } } : entry))} />
        </></Show>
        <Button size="sm" variant="bare" onPress={() => editButtons(buttons => buttons.filter((_entry, at) => at !== index()))}>Remove button</Button>
      </Stack></Card>}</For>
      <Button size="sm" disabled={full()} onPress={() => editButtons(buttons => [...buttons, { kind: 'createTask', label: 'Start task' }])}>Add Start task button</Button>
      <Button size="sm" disabled={full()} onPress={() => editButtons(buttons => [...buttons, { kind: 'open', label: 'Open', reference: { kind: 'record', prefer: 'refPanel' } }])}>Add Open button</Button>
      <Show when={run()?.rows.some(row => row.action?.verb === 'openUrl')}><Button size="sm" disabled={full()} onPress={() => editButtons(buttons => [...buttons, { kind: 'open', label: 'Open in browser', reference: { kind: 'record', prefer: 'external' } }])}>Add Open in browser button</Button></Show>
      <For each={run()?.rows.flatMap(row => row.actions ?? []).filter((action, index, all) => all.findIndex(item => item.id === action.id) === index)}>{action => <Button size="sm" disabled={full()} onPress={() => editButtons(buttons => [...buttons, { kind: 'action', label: action.label, actionId: action.id }])}>Add {action.label} button</Button>}</For>
    </Stack></Field>
  </Stack>
}

function SettingsInspector(props: InspectorProps) {
  const { change, plan } = props.context
  return <Stack gap="row">
    <LabeledInput label="Refresh every (seconds)" value={String(plan().refresh ?? '')} onInput={value => change(current => ({ ...current, refresh: value ? Number(value) : undefined }), { coalesce: true })} />
    <LabeledSelect label="Time zone" value={plan().time.zone} options={timezoneOptions(plan().time.zone)} onChange={zone => change(current => ({ ...current, time: { ...current.time, zone } }))} />
    <LabeledSelect label="Show times in" value={plan().time.mode} options={labelOptions(TIME_MODE_LABELS)} onChange={mode => change(current => ({ ...current, time: { ...current.time, mode: mode as 'fixed' | 'viewer' } }))} />
    <LabeledSelect label="Week starts on" value={plan().time.weekStart} options={labelOptions(WEEK_START_LABELS)} onChange={weekStart => change(current => ({ ...current, time: { ...current.time, weekStart: weekStart as PanelPlan['time']['weekStart'] } }))} />
  </Stack>
}

/** A part key's kind: `stage:2` is a `stage`. */
export const partKind = (key: PlanPartKey) => key.split(':')[0] as PartKind
type PartKind = 'source' | 'relations' | 'columns' | 'column' | 'stage' | 'arrange' | 'look' | 'behaviour' | 'settings'

/** The inspector for each kind of part. */
export const INSPECTORS: Record<PartKind, Component<InspectorProps>> = {
  source: SourceInspector,
  relations: RelationsInspector,
  columns: ColumnsInspector,
  column: ColumnInspector,
  stage: StageInspector,
  arrange: ArrangeInspector,
  look: LookInspector,
  behaviour: BehaviourInspector,
  settings: SettingsInspector,
}

