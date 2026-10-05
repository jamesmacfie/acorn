import { createMemo, createSignal, For, Index, Show, type Component } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { dashboardFields } from '@acorn/dashboards-core/projection'
import { describePanelPlan, newColumnId, outputPlanColumns, type DashboardRun, type PlanProblem, type SourceFailure } from '@acorn/dashboards-core/plan.ts'
import { PANEL_CAPABILITIES } from '@acorn/dashboards-core/capabilities.ts'
import {
  AGGREGATE_LABELS, BUCKET_LABELS, CHART_SHAPE_LABELS, COLUMN_TYPE_LABELS, COMPARE_LABELS, EMPTY_SORT_LABELS, GOOD_DIRECTION_LABELS, GROUP_ORDER_LABELS,
  PRECISION_LABELS, SOURCE_ROLE_LABELS, TIME_MODE_LABELS, TONE_LABELS, TREND_LABELS, UNIT_LABELS, UNMATCHED_LABELS, WEEK_START_LABELS,
  labelOptions, sortDirectionLabel,
} from '@acorn/dashboards-core/labels.ts'
import { availableViews, countsByPart, problemsByPart, switchView, VIEW_ICONS, type PlanInputs, type PlanPartKey } from '@acorn/dashboards-core/outline.ts'
import type { SourceQueryEditorState } from '../../dataSources/SourceQueryEditor'
import SourceQueryEditor from '../../dataSources/SourceQueryEditor'
import { Alert, Button, Card, Checkbox, Chip, Field, Row, SegmentedControl } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { Rows } from '../../../kit/components/layout/Rows'
import { RowActions } from '../../../kit/components/layout/RowActions'
import { Stack } from '../../../kit/components/layout/Stack'
import Icon from '../../../kit/components/content/Icon'
import { Text } from '../../../kit/components/content/Text'
import IconPicker from '../../../kit/components/inputs/IconPicker'
import { Menu } from '../../../kit/components/overlays/Menu'
import { availableContentPresentations } from '../../../host/registries/panes/contentLinks'
import EquivalenceForm from '../EquivalenceForm'
import KeepHistory from '../KeepHistory'
import WriteValueControls from '../WriteValueControls'
import { defaultPlanColumns, unbindMissingFields } from '../dashboardEditorModel'
import { LabeledInput, LabeledSelect } from '../fields'
import { regionRefusal, type PanelRegion } from '../region'
import type { FailureContext } from '../planInputs'
import SourceFailureAlert, { openPluginSettings } from '../SourceFailureAlert'
import { operationForms } from './operationForms'
import { newComparison, wholeNumber, type Stage, type StageFormProps } from './stageFormParts'
import type { StudioChangeOptions } from './studioStore'

// The studio's inspector: one form per kind of plan part, keyed by the part's kind, and one form per
// step operation through `operationForms` (docs/dashboards/mapping-and-editor.md § The generated
// editor). Each form shows only what applies to the selected part, in the label map's words, and
// never asks for an id: new ids come from labels when a part is created.

/** What every inspector reads and writes. */
export type InspectorContext = {
  plan: () => PanelPlan
  change: (update: (current: PanelPlan) => PanelPlan, options?: StudioChangeOptions) => void
  select: (key: PlanPartKey) => void
  workspaceId: string
  run: () => DashboardRun | undefined
  /** The plan's problems, from the schema and the last run. */
  problems: () => readonly PlanProblem[]
  sources: SourceTracking
  /** Each derived source's inputs, by plan source id. */
  inputs: () => PlanInputs
  /** The names and fix targets for a source's failure. */
  failureContext: (problem: PlanProblem & { failure: SourceFailure }) => FailureContext
  /** The plugin area the panel will show in, which can refuse some views. */
  region?: PanelRegion
  /** Opens the AI about a part of the panel: named in the request, and its paths sent as the focus. */
  askAi: (part: PlanPartKey) => void
  /** Refetches every query after a source starts keeping history. */
  refreshQueries: () => void
}

type Column = PanelPlan['columns'][number]
type Choice = NonNullable<Column['choices']>[number]
type Presentation = 'route' | 'refPanel' | 'pane' | 'overlay' | 'external'
type RowButton = NonNullable<PanelPlan['actions']>['buttons'][number]
type InspectorProps = { context: InspectorContext; part: PlanPartKey }

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
/** Every zone this runtime knows, with the chosen one kept even when it does not. The same rule as
 *  the workflow schedule dialog's, which a plugin can't share with client-core. */
const timezoneOptions = (current: string) => {
  const zones = Intl.supportedValuesOf('timeZone')
  return (current && !zones.includes(current) ? [current, ...zones] : zones).map(zone => ({ value: zone, label: zone.replaceAll('_', ' ') }))
}
const presentationOptions = [{ value: 'refPanel', label: 'Side panel' }, { value: 'pane', label: 'Task pane' }, { value: 'route', label: 'Full page' }, { value: 'overlay', label: 'Overlay' }, { value: 'external', label: 'Browser' }]
const columnOptions = (columns: readonly Column[]) => columns.map(column => ({ value: column.id, label: column.label }))
const sourceLabel = (plan: PanelPlan, id: string): string => plan.sources.find(source => source.id === id)?.label ?? id
/** Each source's description by source id, from what its picker last reported. */
const sourceDescriptions = (tracking: SourceTracking): Record<string, DataSourceDescription | undefined> =>
  Object.fromEntries(Object.entries(tracking.states()).map(([id, state]) => [id, state?.description]))
/** Drops an optional key, because the plan schema is strict and refuses `undefined` values. */
const without = <T extends object, K extends string>(value: T, key: K): T extends unknown ? Omit<T, K> : never => {
  const { [key]: _dropped, ...rest } = value as Record<string, unknown>
  return rest as T extends unknown ? Omit<T, K> : never
}

// ── Plan edits the outline's Add menu shares ─────────────────────────────────────────────────────

export const addSourceTo = (plan: PanelPlan, reference: QueryReference): PanelPlan =>
  ({ ...plan, sources: [...plan.sources, { id: crypto.randomUUID(), label: `Source ${plan.sources.length + 1}`, role: 'primary', reference }] })
export const addColumnTo = (plan: PanelPlan): PanelPlan =>
  ({ ...plan, columns: [...plan.columns, { id: newColumnId(plan, 'New column'), label: 'New column', type: 'text', bind: {} }] })
/** The plan with a new step for `op` at the end, or the plan unchanged when the step needs columns it
 *  lacks. Ids for the columns a step makes come from their labels. */
export const addStageTo = (plan: PanelPlan, op: Stage['op']): PanelPlan => {
  const columns = outputPlanColumns(plan)
  const dates = columns.filter(column => column.type === 'datetime')
  const list = columns.find(column => column.list)
  const stage: Stage | undefined = op === 'filter' ? { op, where: newComparison(columns[0]) }
    : op === 'compute' ? { op, columns: [{ id: newColumnId(plan, 'Calculated value'), label: 'Calculated value', type: 'number', expression: { kind: 'column', column: columns.find(column => column.type === 'number')?.id ?? columns[0]?.id ?? '' } }] }
    : op === 'summarize' ? { op, by: [], measures: [{ id: newColumnId(plan, 'Count'), label: 'Count', kind: 'count' }] }
    : op === 'expand' && list ? { op, column: list.id, output: newColumnId(plan, `${list.label} item`), perRow: 100 }
    : op === 'overlap' && dates.length >= 2 ? { op, start: dates[0]!.id, end: dates[1]!.id, maxPairs: 5000 } : undefined
  return stage ? { ...plan, stages: [...plan.stages, stage] } : plan
}
export const removeSourceFrom = (plan: PanelPlan, id: string): PanelPlan => ({
  ...plan,
  sources: plan.sources.filter(source => source.id !== id),
  relations: plan.relations?.filter(relation => relation.from !== id && relation.to !== id),
  columns: plan.columns.map(column => ({ ...column, bind: without(column.bind, id) })),
})
export const removeColumnFrom = (plan: PanelPlan, id: string): PanelPlan => ({ ...plan, columns: plan.columns.filter(column => column.id !== id) })
export const removeStageFrom = (plan: PanelPlan, index: number): PanelPlan => ({ ...plan, stages: plan.stages.filter((_stage, at) => at !== index) })
/** Swaps an item with its neighbour, `by` -1 for up and 1 for down. Unchanged at either end. */
const swap = <T,>(items: readonly T[], index: number, by: -1 | 1): T[] | undefined => {
  const target = index + by
  if (target < 0 || target >= items.length) return undefined
  const moved = [...items]
  ;[moved[index], moved[target]] = [moved[target]!, moved[index]!]
  return moved
}
export const moveStageIn = (plan: PanelPlan, index: number, by: -1 | 1): PanelPlan => {
  const stages = swap(plan.stages, index, by)
  return stages ? { ...plan, stages } : plan
}
export const moveColumnIn = (plan: PanelPlan, index: number, by: -1 | 1): PanelPlan => {
  const columns = swap(plan.columns, index, by)
  return columns ? { ...plan, columns } : plan
}

// ── Sources ────────────────────────────────────────────────────────────────────────────────────

export type SourceTracking = ReturnType<typeof createSourceTracking>

/** The starter with every source that reads the same source as `picked` moved onto its scope: the
 *  workspace, account, and reach the person chose. A starter carries no account of its own. */
export function starterForPick(starter: PanelPlan, picked: Pick<DataSourceQuery, 'source' | 'scope'>): PanelPlan {
  const same = (query: DataSourceQuery) => query.source.pluginId === picked.source.pluginId && query.source.sourceId === picked.source.sourceId
  return { ...starter, sources: starter.sources.map(entry => entry.reference.kind !== 'inline' || !same(entry.reference.content.query) ? entry
    : { ...entry, reference: { ...entry.reference, content: { ...entry.reference.content, query: { ...entry.reference.content.query, scope: picked.scope } } } }) }
}

/** A description's starter plans that parse, moved onto the picked scope, and that the Node accepts. */
export async function checkedStarters(
  description: DataSourceDescription,
  picked: Pick<DataSourceQuery, 'source' | 'scope'>,
  validate: (plan: PanelPlan) => Promise<{ problems: string[] }>,
): Promise<PanelPlan[]> {
  // A plain copy, because a description read from the query cache is a reactive proxy that the strict
  // data parsers refuse.
  const plain = JSON.parse(JSON.stringify(description.starterPlans ?? [])) as unknown[]
  const candidates = plain.flatMap(candidate => {
    const parsed = panelPlanSchema.safeParse(candidate)
    return parsed.success ? [starterForPick(parsed.data, picked)] : []
  })
  const checked = await Promise.all(candidates.map(plan => validate(plan).then(result => result.problems.length ? undefined : plan, () => undefined)))
  return checked.filter((plan): plan is PanelPlan => !!plan)
}

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
    if (priorRevision !== state.description.revision) void checkedStarters(state.description, state.query, input.validate)
      .then(plans => setStarters(current => ({ ...current, [id]: plans })))
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

/** Source, account, reach, and scope come from the picker. Then how a second source joins, the
 *  source's starter plans, and the source-level actions. */
export function SourceInspector(props: InspectorProps) {
  const context = props.context
  const id = () => props.part.slice('source:'.length)
  const source = () => context.plan().sources.find(entry => entry.id === id())
  const state = () => context.sources.states()[id()]
  const setReference = (reference: QueryReference | undefined): void => context.change(current => reference
    ? { ...current, sources: current.sources.map(entry => entry.id === id() ? { ...entry, reference } : entry) }
    : removeSourceFrom(current, id()))
  const starterPlans = () => context.sources.starters()[id()] ?? []
  // The source's own problems and its inputs', each in plain words with its fix. Choosing an account
  // happens in the picker below, so that fix isn't repeated here.
  const failures = createMemo(() => {
    const grouped = problemsByPart(context.plan(), context.problems(), context.inputs())
    return Object.entries(grouped).flatMap(([key, problems]) => key === `source:${id()}` || key.startsWith(`input:${id()}:`) ? problems ?? [] : [])
  })
  return <Show when={source()}>{current => <Stack gap="row">
    <For each={failures()}>{problem => <Show when={problem.failure} fallback={<Alert tone="warn">{problem.message}</Alert>}>{failure => (
      <SourceFailureAlert failure={failure()} context={context.failureContext({ ...problem, failure: failure() })} severity={problem.severity} />
    )}</Show>}</For>
    <SourceQueryEditor workspaceId={context.workspaceId} value={current().reference} hideAuthoring hideConditions hidePreview pickSourceAccount
      onChange={setReference} onStateChange={next => context.sources.report(id(), next)} />
    <Show when={context.plan().sources.length > 1}>
      <LabeledSelect label="How it joins" value={current().role} options={labelOptions(SOURCE_ROLE_LABELS)}
        onChange={role => context.change(plan => ({ ...plan, sources: plan.sources.map(entry => entry.id === id() ? { ...entry, role: role as typeof entry.role } : entry) }))} />
    </Show>
    <Show when={starterPlans().length}><Field label="Start from" group><Inline gap="inline" wrap>
      <For each={starterPlans()}>{starter => <Button size="sm" tip={describePanelPlan(starter)[0]} onPress={() => context.change(() => starter)}>{starter.title}</Button>}</For>
    </Inline></Field></Show>
    <Inline gap="inline" wrap>
      <Show when={state()?.query && state()?.description && state()?.source}>
        <KeepHistory query={state()!.query!} description={state()!.description!} sourceName={state()!.source!.name} onCreated={context.refreshQueries} />
      </Show>
      <Show when={state()?.source?.inputs && state()!.source!.pluginId}>{plugin => <Button size="sm" variant="ghost" onPress={() => openPluginSettings(plugin())}>About this source</Button>}</Show>
      <Button size="sm" variant="ghost" onPress={() => setReference(undefined)}>Remove source</Button>
    </Inline>
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
    const label = declared.label
    const output = declared.cardinality === 'one-to-many' ? newColumnId(plan(), label) : undefined
    context.change(current => ({ ...current,
      relations: [...current.relations ?? [], { id: declared.id, from, to, kind: declared.kind, cardinality: declared.cardinality,
        keys: declared.keys, unmatched: 'keep', maxMatches: 5000, ...(output ? { output } : {}) }],
      columns: output ? [...current.columns, { id: output, label, type: 'text', list: true, bind: {} }] : current.columns,
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

/** The field type a column of each type reads, so compatible fields list first. */
const fieldType = (field: DataSourceDescription['fields'][number]): Column['type'] => {
  const kind = field.display?.kind
  return kind === 'status' ? 'enum' : kind
}
/** The field a column reads from one source, by its pointer. */
const boundField = (column: Column, sourceId: string): string | undefined => {
  const binding = column.bind[sourceId]
  return binding && 'field' in binding ? binding.field : undefined
}

function ColumnsInspector(props: InspectorProps) {
  const context = props.context
  const plan = context.plan
  const fieldLabel = (column: Column): string => {
    for (const source of plan().sources) {
      const pointer = boundField(column, source.id)
      if (!pointer) continue
      const field = context.sources.states()[source.id]?.description?.fields.find(entry => entry.pointer === pointer)
      return field ? `From ${field.label}` : 'Its field is missing'
    }
    return 'Not read from a source'
  }
  const items = () => plan().columns.map((column, index) => ({ key: column.id, column, index }))
  return <Stack gap="row">
    <Rows id="dashboards.studio.columns" ariaLabel="Columns" items={items()} selected={null}
      onSelect={key => context.select(`column:${key}`)} onActivate={key => context.select(`column:${key}`)}>
      {(item, itemProps, selected) => <Row item={itemProps} selected={selected()} density="compact" variant="stacked"
        onPress={() => context.select(`column:${item.column.id}`)}
        meta={<Text emphasis="muted">{item.column.list ? `List of ${COLUMN_TYPE_LABELS[item.column.type ?? 'text'].toLowerCase()}` : COLUMN_TYPE_LABELS[item.column.type ?? 'text']}</Text>}
        trailing={<RowActions ariaLabel={`Actions for ${item.column.label}`}>{menu => <>
          <Menu.Item context={menu} disabled={item.index === 0} onSelect={() => context.change(current => moveColumnIn(current, item.index, -1))}>Move up</Menu.Item>
          <Menu.Item context={menu} disabled={item.index === plan().columns.length - 1} onSelect={() => context.change(current => moveColumnIn(current, item.index, 1))}>Move down</Menu.Item>
          <Menu.Item context={menu} tone="danger" onSelect={() => context.change(current => removeColumnFrom(current, item.column.id))}>Remove</Menu.Item>
          <Menu.Item context={menu} onSelect={() => context.askAi(`column:${item.column.id}`)}>Ask AI about this</Menu.Item>
        </>}</RowActions>}>
        <Stack gap="none"><Text>{item.column.label}</Text><Text emphasis="muted">{fieldLabel(item.column)}</Text></Stack>
      </Row>}
    </Rows>
    <Inline><Button size="sm" onPress={() => { context.change(addColumnTo); context.select(`column:${plan().columns.at(-1)!.id}`) }}>Add column</Button></Inline>
  </Stack>
}

/** A number column's unit as one choice: a fixed unit, a currency, or another column. */
const unitChoice = (unit: Column['unit']): string => unit === undefined ? '' : typeof unit === 'object' ? 'column' : unit in UNIT_LABELS ? unit : 'currency'

function ColumnInspector(props: InspectorProps) {
  const context = props.context
  const plan = context.plan
  const states = context.sources.states
  const column = () => plan().columns.find(entry => `column:${entry.id}` === props.part)
  const editColumn = (update: (column: Column) => Column, options?: StudioChangeOptions): void =>
    context.change(current => ({ ...current, columns: current.columns.map(entry => `column:${entry.id}` === props.part ? update(entry) : entry) }), options)
  const editChoice = (index: number, update: (choice: Choice) => Choice, options?: StudioChangeOptions): void =>
    editColumn(entry => ({ ...entry, choices: entry.choices?.map((choice, at) => at === index ? update(choice) : choice) }), options)
  const bindColumn = (sourceId: string, pointer: string): void => editColumn(entry => {
    if (!pointer) return { ...entry, bind: without(entry.bind, sourceId) }
    return { ...entry, bind: { ...entry.bind, [sourceId]: { field: pointer } } }
  })
  /** One source's fields, those of a compatible type first, each with its type. */
  const fieldOptions = (sourceId: string) => {
    const current = column()!
    const fields = states()[sourceId]?.description?.fields ?? []
    const fits = (field: typeof fields[number]) => !current.type || fieldType(field) === current.type
    const pointer = boundField(current, sourceId)
    const missing = pointer && !fields.some(field => field.pointer === pointer) ? [{ value: pointer, label: `${pointer.slice(1).split('/').at(-1)} is missing, choose another` }] : []
    return [{ value: '', label: 'Not from this source' }, ...missing,
      ...[...fields.filter(fits), ...fields.filter(field => !fits(field))].map(field => ({ value: field.pointer, label: field.label, description: COLUMN_TYPE_LABELS[fieldType(field) ?? 'text'] }))]
  }
  const suggestedBinding = (sourceId: string): { pointer: string; name: string } | undefined => {
    const current = column()!
    const description = states()[sourceId]?.description
    if (current.bind[sourceId] || !description) return undefined
    const fields = dashboardFields(description)
    const match = fields.find(field => field.type === current.type && field.name.toLowerCase() === current.label.toLowerCase())
      ?? fields.find(field => field.type === current.type && field.role === current.id)
    return match ? { pointer: match.id, name: match.name } : undefined
  }
  /** The values a source's choice field declares, for mapping each to one of the column's choices. */
  const sourceValues = (sourceId: string) => {
    const pointer = boundField(column()!, sourceId)
    const field = pointer ? states()[sourceId]?.description?.fields.find(item => item.pointer === pointer) : undefined
    return field?.choices?.kind === 'static' ? field.choices.values : []
  }
  const mappedChoice = (sourceId: string, valueId: string): string => {
    const binding = column()!.bind[sourceId]
    return binding && 'field' in binding ? Object.entries(binding.values ?? {}).find(([, ids]) => ids.includes(valueId))?.[0] ?? '' : ''
  }
  const mapChoice = (sourceId: string, valueId: string, choiceId: string): void => editColumn(entry => {
    const binding = entry.bind[sourceId]
    if (!binding || !('field' in binding)) return entry
    const values = Object.fromEntries(Object.entries(binding.values ?? {}).map(([id, ids]) => [id, ids.filter(value => value !== valueId)]))
    if (choiceId) values[choiceId] = [...(values[choiceId] ?? []), valueId]
    return { ...entry, bind: { ...entry.bind, [sourceId]: { ...binding, values } } }
  })
  const setUnit = (choice: string): void => editColumn(entry => {
    const rest = without(entry, 'unit')
    return choice === '' ? rest : choice === 'column' ? { ...rest, unit: { column: plan().columns.find(other => other.id !== entry.id)?.id ?? '' } }
      : choice === 'currency' ? { ...rest, unit: 'USD' } : { ...rest, unit: choice }
  })

  return <Show when={column()}>{current => <Stack gap="row">
    <LabeledInput label="Name" value={current().label} onInput={label => editColumn(entry => ({ ...entry, label }), { coalesce: true })} />
    <Field label="From" group><Stack gap="row">
      <For each={plan().sources}>{source => <>
        <LabeledSelect label={plan().sources.length > 1 ? source.label : 'Field'} value={boundField(current(), source.id) ?? ''} options={fieldOptions(source.id)}
          onChange={pointer => bindColumn(source.id, pointer)} />
        <Show when={suggestedBinding(source.id)}>{suggestion => <Inline>
          <Chip onPress={() => bindColumn(source.id, suggestion().pointer)} leading={<Icon name="sparkles" />}>{`Use ${suggestion().name}`}</Chip>
        </Inline>}</Show>
      </>}</For>
    </Stack></Field>
    <LabeledSelect label="Type" value={current().type ?? 'text'} options={labelOptions(COLUMN_TYPE_LABELS)}
      onChange={type => editColumn(entry => {
        // Settings for the old type don't apply to the new one, and the plan refuses some of them.
        const rest = without(without(without(without(entry, 'unit'), 'precision'), 'choices'), 'unmatched')
        return { ...rest, type: type as NonNullable<Column['type']>,
          ...(type === entry.type ? { ...(entry.unit ? { unit: entry.unit } : {}), ...(entry.precision ? { precision: entry.precision } : {}), ...(entry.choices ? { choices: entry.choices } : {}), ...(entry.unmatched ? { unmatched: entry.unmatched } : {}) } : {}) }
      })} />

    <Show when={current().type === 'number'}>
      <LabeledSelect label="Unit" value={unitChoice(current().unit)}
        options={[{ value: '', label: 'None' }, ...labelOptions(UNIT_LABELS), { value: 'currency', label: 'Currency' }, { value: 'column', label: 'Read the unit from another column' }]} onChange={setUnit} />
      <Show when={unitChoice(current().unit) === 'currency'}>
        <LabeledInput label="Currency code" hint="Three letters, such as USD" maxLength={3} value={String(current().unit ?? '')}
          onInput={code => editColumn(entry => code.trim() ? { ...entry, unit: code.trim().toUpperCase() } : without(entry, 'unit'), { coalesce: true })} />
      </Show>
      <Show when={typeof current().unit === 'object' ? current().unit as { column: string } : undefined}>{unit => (
        <LabeledSelect label="Unit column" value={unit().column} options={columnOptions(plan().columns.filter(entry => entry.id !== current().id))}
          onChange={unitColumn => editColumn(entry => ({ ...entry, unit: { column: unitColumn } }))} />
      )}</Show>
    </Show>
    <Show when={current().type === 'datetime'}>
      <LabeledSelect label="Show as" value={current().precision ?? 'instant'} options={labelOptions(PRECISION_LABELS)}
        onChange={precision => editColumn(entry => precision === 'day' ? { ...entry, precision: 'day' } : without(entry, 'precision'))} />
    </Show>
    <Show when={current().type === 'enum'}>
      <Field label="Choices" group><Stack gap="row">
        <Index each={current().choices ?? []}>{(choice, index) => <div class="dash-studio-choice">
          <LabeledInput label="Name" value={choice().label} onInput={label => editChoice(index, value => ({ ...value, label }), { coalesce: true })} />
          <LabeledSelect label="Colour" value={choice().tone ?? 'muted'} options={labelOptions(TONE_LABELS)} onChange={tone => editChoice(index, value => ({ ...value, tone: tone as NonNullable<Choice['tone']> }))} />
          <LabeledInput label="Order" type="number" value={String(choice().rank ?? '')}
            onInput={rank => editChoice(index, value => { const rest = without(value, 'rank'); return rank.trim() && Number.isFinite(Number(rank)) ? { ...rest, rank: Number(rank) } : rest }, { coalesce: true })} />
          <WriteValueControls column={current()} choice={choice()} sources={plan().sources} descriptions={sourceDescriptions(context.sources)}
            onChange={(sourceId, value, present) => editChoice(index, candidate => {
              const writeValues = without(candidate.writeValues ?? {}, sourceId)
              return { ...candidate, writeValues: present ? { ...writeValues, [sourceId]: value! } : writeValues }
            })} />
          <Inline><Button size="sm" variant="bare" onPress={() => editColumn(entry => ({ ...entry, choices: entry.choices?.filter((_choice, at) => at !== index) }))}>Remove choice</Button></Inline>
        </div>}</Index>
        <Inline><Button size="sm" onPress={() => editColumn(entry => ({ ...entry, choices: [...entry.choices ?? [], { id: crypto.randomUUID(), label: 'New choice' }] }))}>Add choice</Button></Inline>
      </Stack></Field>
      <For each={plan().sources.filter(source => sourceValues(source.id).length)}>{source => <Field label={plan().sources.length > 1 ? `${source.label} values` : 'Source values'} group><Stack gap="row">
        <For each={sourceValues(source.id)}>{value => <LabeledSelect label={value.label} value={mappedChoice(source.id, value.id)}
          options={[{ value: '', label: 'Not listed' }, ...(current().choices ?? []).map(choice => ({ value: choice.id, label: choice.label }))]}
          onChange={choiceId => mapChoice(source.id, value.id, choiceId)} />}</For>
      </Stack></Field>}</For>
      <LabeledSelect label="Values not listed" value={current().unmatched ?? 'catch-all'} options={labelOptions(UNMATCHED_LABELS)}
        onChange={unmatched => editColumn(entry => ({ ...entry, unmatched: unmatched as NonNullable<Column['unmatched']> }))} />
    </Show>
    <Checkbox label="Holds a list of values" checked={!!current().list} onChange={list => editColumn(entry => list ? { ...entry, list } : without(entry, 'list'))} />
    <Show when={plan().relations?.some(relation => relation.kind === 'equivalence')}>
      <LabeledSelect label="Prefer the value from" value={current().precedence?.[0] ?? ''}
        options={[{ value: '', label: 'Whichever has one' }, ...plan().sources.filter(source => source.role === 'primary').map(source => ({ value: source.id, label: source.label }))]}
        onChange={sourceId => editColumn(entry => sourceId ? { ...entry, precedence: [sourceId] } : without(entry, 'precedence'))} />
    </Show>
  </Stack>}</Show>
}

// ── Steps ──────────────────────────────────────────────────────────────────────────────────────

function StageInspector(props: InspectorProps) {
  const context = props.context
  const plan = context.plan
  const index = () => Number(props.part.slice('stage:'.length))
  const stage = () => plan().stages[index()]
  // What the step reads: the plan's columns after the steps before it.
  const columns = createMemo(() => outputPlanColumns({ ...plan(), stages: plan().stages.slice(0, index()) }))
  const descriptions = createMemo(() => sourceDescriptions(context.sources))
  const count = () => countsByPart(plan(), context.run()?.diagnostics.stages ?? []).stages[props.part]
  const problems = () => problemsByPart(plan(), context.problems())[props.part] ?? []
  const change = (next: Stage, options?: StudioChangeOptions) =>
    context.change(current => ({ ...current, stages: current.stages.map((entry, at) => at === index() ? next : entry) }), options)
  // Each form takes its own operation's step. The registry is typed per operation, which `Dynamic`
  // can't follow, so the form is read here as one that takes any step.
  const form = () => operationForms[stage()!.op] as unknown as Component<StageFormProps>
  return <Show when={stage()}>{current => <Stack gap="row">
    <Dynamic component={form()} stage={current()} columns={columns()} plan={plan()} sources={descriptions()} onChange={change} />
    <Show when={count()}>{counted => <Text emphasis="muted">{`${plural(counted().input, 'row')} in · ${plural(counted().output, 'row')} out`}</Text>}</Show>
    <For each={problems()}>{problem => <Alert tone="warn">{problem.message}</Alert>}</For>
    <Inline><Button size="sm" variant="bare" onPress={() => context.change(current => removeStageFrom(current, index()))}>Remove step</Button></Inline>
  </Stack>}</Show>
}

// ── Arrange, look, behaviour, settings ───────────────────────────────────────────────────────────

type Sort = NonNullable<PanelPlan['sort']>[number]
type Group = NonNullable<PanelPlan['group']>[number]

function ArrangeInspector(props: InspectorProps) {
  const { change, plan, run } = props.context
  const columns = createMemo(() => outputPlanColumns(plan()))
  const typeOf = (id: string) => columns().find(column => column.id === id)?.type
  const editSort = (index: number, update: (sort: Sort) => Sort) => change(current => ({ ...current, sort: current.sort?.map((entry, at) => at === index ? update(entry) : entry) }))
  const editGroup = (index: number, update: (group: Group) => Group) => change(current => ({ ...current, group: current.group?.map((entry, at) => at === index ? update(entry) : entry) }))
  /** The group keys a custom order lists: stored ones first, then the column's choices and the groups
   *  the last run made at this level. A key is the raw value, so a choice shows by its label. */
  const groupKeys = (group: Group, index: number): string[] => {
    const groups = run()?.groups ?? []
    const made = index === 0 ? groups : groups.flatMap(entry => entry.children ?? [])
    return [...new Set([...group.values ?? [], ...columns().find(column => column.id === group.column)?.choices?.map(choice => choice.id) ?? [], ...made.map(entry => entry.key)])]
  }
  const keyLabel = (group: Group, key: string) => columns().find(column => column.id === group.column)?.choices?.find(choice => choice.id === key)?.label ?? key
  const moveValue = (index: number, at: number, by: -1 | 1) => editGroup(index, group => ({ ...group, values: swap(groupKeys(group, index), at, by) ?? group.values }))
  const pickGroupColumn = (index: number, column: string) => editGroup(index, group => {
    const rest = without(without(group, 'bucket'), 'values')
    return { ...rest, column, ...(typeOf(column) === 'datetime' && group.bucket ? { bucket: group.bucket } : {}) }
  })
  return <Stack gap="stack">
    <Field label="Sort by" group><Stack gap="row">
      <Index each={plan().sort ?? []}>{(sort, index) => <div class="dash-studio-condition">
        <LabeledSelect label="Column" value={sort().column} options={columnOptions(columns())} onChange={column => editSort(index, entry => ({ ...entry, column }))} />
        <LabeledSelect label="Order" value={sort().direction}
          options={(['desc', 'asc'] as const).map(direction => { const words = sortDirectionLabel(direction, typeOf(sort().column)); return { value: direction, label: words[0]!.toUpperCase() + words.slice(1) } })}
          onChange={direction => editSort(index, entry => ({ ...entry, direction: direction as Sort['direction'] }))} />
        <LabeledSelect label="Empty values" value={sort().empty ?? 'last'} options={labelOptions(EMPTY_SORT_LABELS)}
          onChange={empty => editSort(index, entry => ({ ...entry, empty: empty as NonNullable<Sort['empty']> }))} />
        <Inline><Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, sort: current.sort?.filter((_entry, at) => at !== index) }))}>Remove</Button></Inline>
      </div>}</Index>
      <Inline><Button size="sm" disabled={(plan().sort?.length ?? 0) >= 8 || !columns().length}
        onPress={() => change(current => ({ ...current, sort: [...current.sort ?? [], { column: columns()[0]!.id, direction: 'desc' }] }))}>Add sort</Button></Inline>
    </Stack></Field>
    <Field label="Group by" group><Stack gap="row">
      <Index each={plan().group ?? []}>{(group, index) => <div class="dash-studio-condition">
        <LabeledSelect label="Column" value={group().column} options={columnOptions(columns())} onChange={column => pickGroupColumn(index, column)} />
        <Show when={typeOf(group().column) === 'datetime'}>
          <LabeledSelect label="Group" value={group().bucket ?? 'value'} options={labelOptions(BUCKET_LABELS)}
            onChange={bucket => editGroup(index, entry => bucket === 'value' ? without(entry, 'bucket') : { ...entry, bucket: bucket as Group['bucket'] })} />
        </Show>
        <LabeledSelect label="Order groups by" value={group().order ?? 'declared'} options={labelOptions(GROUP_ORDER_LABELS)}
          onChange={order => editGroup(index, entry => order === 'explicit' ? { ...entry, order, values: groupKeys(entry, index) } : { ...without(entry, 'values'), order: order as Group['order'] })} />
        <Show when={group().order === 'explicit'}>
          <Stack gap="none"><Index each={group().values ?? []}>{(value, at) => <Inline gap="inline">
            <Text>{keyLabel(group(), value())}</Text>
            <Button size="xs" variant="bare" disabled={at === 0} onPress={() => moveValue(index, at, -1)}>Up</Button>
            <Button size="xs" variant="bare" disabled={at === (group().values?.length ?? 0) - 1} onPress={() => moveValue(index, at, 1)}>Down</Button>
          </Inline>}</Index></Stack>
        </Show>
        <Inline><Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, group: current.group?.filter((_entry, at) => at !== index) }))}>Remove</Button></Inline>
      </div>}</Index>
      <Inline><Button size="sm" disabled={(plan().group?.length ?? 0) >= 2 || !columns().length}
        onPress={() => change(current => ({ ...current, group: [...current.group ?? [], { column: columns()[0]!.id }] }))}>Add grouping</Button></Inline>
    </Stack></Field>
    <LabeledInput label="Show at most" hint="Leave empty to show every row" type="number" min={1} max={5000} value={String(plan().limit ?? '')}
      onInput={raw => change(current => { const limit = wholeNumber(raw); return limit ? { ...current, limit } : without(current, 'limit') }, { coalesce: true })} />
  </Stack>
}

function LookInspector(props: InspectorProps) {
  const { change, plan, region } = props.context
  const view = () => plan().view
  const viewHas = (option: string): boolean => (PANEL_CAPABILITIES.views[view().kind].options as readonly string[]).includes(option)
  const columns = createMemo(() => outputPlanColumns(plan()))
  const editView = (update: (view: PanelPlan['view']) => PanelPlan['view']) => change(current => ({ ...current, view: update(current.view) }))
  const setOption = <K extends 'field' | 'x' | 'series' | 'trend' | 'compare' | 'good'>(key: K, value: string) =>
    editView(current => value ? { ...current, [key]: value } : without(current, key) as PanelPlan['view'])
  const views = () => availableViews(plan()).map(entry => {
    const refused = region ? regionRefusal(region, entry.id, {}) : undefined
    return { ...entry, available: entry.available && !refused, reason: entry.reason ?? refused }
  })
  const pickView = (kind: PanelPlan['view']['kind']) => change(current => switchView(current, kind))
  const numberColumns = () => columns().filter(column => column.type === 'number')
  // The stat's number as one choice: a count of rows, or a calculation over a column.
  const statNumber = () => view().aggregate && view().aggregate !== 'count' ? view().aggregate! : 'count'
  return <Stack gap="row">
    {/* Icons, with each view's name as its tooltip and for screen readers: five named segments don't
        fit the inspector's 320 pixels, and the heading above names the chosen view. */}
    <Field label="Show as" group>
      <SegmentedControl ariaLabel="Show as" size="sm" value={view().kind} onChange={pickView}
        options={views().map(entry => ({ value: entry.id, label: <><Icon name={VIEW_ICONS[entry.id]} /><span class="sr-only">{entry.label}</span></>,
          disabled: !entry.available && entry.id !== view().kind, title: entry.reason ? `${entry.label}: ${entry.reason}` : entry.label }))} />
    </Field>
    <Show when={view().kind === 'stat'}>
      <LabeledSelect label="Number" value={statNumber()}
        options={[{ value: 'count', label: 'Count of rows' }, ...(['sum', 'avg', 'min', 'max'] as const).map(aggregate => ({ value: aggregate, label: `${AGGREGATE_LABELS[aggregate]} of a column` }))]}
        onChange={aggregate => editView(current => aggregate === 'count' ? { ...without(current, 'field'), aggregate: 'count' }
          : { ...current, aggregate: aggregate as NonNullable<PanelPlan['view']['aggregate']>, ...(current.field ? {} : numberColumns()[0] ? { field: numberColumns()[0]!.id } : {}) })} />
      <Show when={statNumber() !== 'count'}>
        <LabeledSelect label="Of" value={view().field ?? ''} options={[...view().field ? [] : [{ value: '', label: 'Choose a column' }], ...columnOptions(numberColumns())]} onChange={field => setOption('field', field)} />
      </Show>
      <LabeledSelect label="Trend" value={view().trend ?? ''} options={[{ value: '', label: 'None' }, ...labelOptions(TREND_LABELS)]} onChange={trend => setOption('trend', trend)} />
      <LabeledSelect label="Compare with" value={view().compare ?? ''} options={[{ value: '', label: 'None' }, ...labelOptions(COMPARE_LABELS)]} onChange={compare => setOption('compare', compare)} />
      <LabeledSelect label="Good direction" value={view().good ?? ''} options={[{ value: '', label: 'Neither' }, ...labelOptions(GOOD_DIRECTION_LABELS)]} onChange={good => setOption('good', good)} />
    </Show>
    <Show when={viewHas('shape')}>
      <LabeledSelect label="Shape" value={view().shape ?? 'bar'} options={labelOptions(CHART_SHAPE_LABELS)} onChange={shape => editView(current => ({ ...current, shape: shape as 'bar' | 'line' }))} />
      <LabeledSelect label="Across" value={view().x ?? ''} options={[...view().x ? [] : [{ value: '', label: 'Choose a column' }], ...columnOptions(columns().filter(column => column.type === 'datetime' || column.type === 'enum'))]} onChange={x => setOption('x', x)} />
      <LabeledSelect label="Split by" value={view().series ?? ''} options={[{ value: '', label: 'Nothing' }, ...columnOptions(columns())]} onChange={series => setOption('series', series)} />
    </Show>
    <Show when={view().kind === 'board'}><Text emphasis="muted" wrap>Board columns come from the first grouping.</Text></Show>
  </Stack>
}

function BehaviourInspector(props: InspectorProps) {
  const { change, plan, run } = props.context
  const editButton = (index: number, update: (button: RowButton) => RowButton, options?: StudioChangeOptions): void =>
    change(current => ({ ...current, actions: { ...current.actions, buttons: (current.actions?.buttons ?? []).map((entry, at) => at === index ? update(entry) : entry) } }), options)
  const setPress = (press: NonNullable<PanelPlan['actions']>['press'] | undefined) =>
    change(current => ({ ...current, actions: { buttons: current.actions?.buttons ?? [], ...(press ? { press } : {}) } }))
  const links = () => plan().columns.filter(column => column.type === 'link')
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
  const pressChoice = () => { const press = plan().actions?.press; return !press ? '' : press.kind === 'link' ? `link:${press.column ?? ''}` : press.kind }
  const pickPress = (choice: string) => setPress(!choice ? undefined : choice.startsWith('link:')
    ? { kind: 'link', column: choice.slice('link:'.length), prefer: 'refPanel' }
    : { kind: choice as 'record' | 'task', prefer: choice === 'task' ? 'pane' : 'refPanel' })
  const sourceActions = () => (run()?.rows ?? []).flatMap(row => row.actions ?? []).filter((action, index, all) => all.findIndex(item => item.id === action.id) === index)
  const does = (button: RowButton) => button.kind === 'action' ? `action:${button.actionId}` : button.kind
  const pickDoes = (index: number, choice: string) => editButton(index, button => {
    const shared = { label: button.label, ...(button.icon ? { icon: button.icon } : {}) }
    return choice === 'open' ? { ...shared, kind: 'open', reference: { kind: 'record', prefer: 'refPanel' } }
      : choice === 'createTask' ? { ...shared, kind: 'createTask' } : { ...shared, kind: 'action', actionId: choice.slice('action:'.length) }
  })
  const opens = (button: Extract<RowButton, { kind: 'open' }>) => button.reference.kind === 'link' ? `link:${button.reference.column ?? ''}` : button.reference.kind
  const full = () => (plan().actions?.buttons.length ?? 0) >= 3
  return <Stack gap="stack">
    <Field label="When someone clicks a row" group><Stack gap="row">
      <LabeledSelect label="Click" value={pressChoice()}
        options={[{ value: '', label: "Do the source's default" },
          ...(run()?.rows.some(row => !!row.action || !!row.target) ? [{ value: 'record', label: 'Open the record' }] : []),
          ...(run()?.rows.some(row => !!row.taskId) ? [{ value: 'task', label: 'Open its task' }] : []),
          ...links().map(column => ({ value: `link:${column.id}`, label: `Open a link from ${column.label}` }))]}
        onChange={pickPress} />
      <Show when={plan().actions?.press}>{press => <Show when={pressPresentations().length || press().prefer}>
        <LabeledSelect label="Open in" value={press().prefer}
          options={presentationOptions.filter(option => option.value === press().prefer || pressPresentations().includes(option.value))}
          onChange={prefer => setPress({ ...press(), prefer: prefer as Presentation })} />
      </Show>}</Show>
    </Stack></Field>
    <Field label="Buttons on each row" group><Stack gap="row">
      <Index each={plan().actions?.buttons ?? []}>{(button, index) => <Card><Stack gap="row">
        <LabeledInput label="Label" value={button().label} onInput={label => editButton(index, entry => ({ ...entry, label }), { coalesce: true })} />
        <Field label="Icon" group><IconPicker ariaLabel="Icon" value={button().icon ?? null} fallback="mouse-pointer-click"
          onSelect={icon => editButton(index, entry => icon ? { ...entry, icon } : without(entry, 'icon'))} /></Field>
        <LabeledSelect label="Does" value={does(button())}
          options={[{ value: 'open', label: 'Open' }, { value: 'createTask', label: 'Start a task' },
            ...sourceActions().map(action => ({ value: `action:${action.id}`, label: action.label })),
            ...(button().kind === 'action' && !sourceActions().some(action => `action:${action.id}` === does(button())) ? [{ value: does(button()), label: button().label }] : [])]}
          onChange={choice => pickDoes(index, choice)} />
        <Show when={button().kind === 'open' ? button() as Extract<RowButton, { kind: 'open' }> : undefined}>{open => <>
          <LabeledSelect label="Opens" value={opens(open())}
            options={[{ value: 'record', label: 'The record' }, { value: 'task', label: 'Its task' }, ...links().map(column => ({ value: `link:${column.id}`, label: `A link from ${column.label}` }))]}
            onChange={value => editButton(index, entry => entry.kind !== 'open' ? entry : { ...entry, reference: value.startsWith('link:')
              ? { kind: 'link', column: value.slice('link:'.length), prefer: entry.reference.prefer } : { kind: value as 'record' | 'task', prefer: entry.reference.prefer } })} />
          <LabeledSelect label="Open in" value={open().reference.prefer} options={presentationOptions}
            onChange={prefer => editButton(index, entry => entry.kind === 'open' ? { ...entry, reference: { ...entry.reference, prefer: prefer as Presentation } } : entry)} />
        </>}</Show>
        <Inline><Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, actions: { ...current.actions, buttons: (current.actions?.buttons ?? []).filter((_entry, at) => at !== index) } }))}>Remove button</Button></Inline>
      </Stack></Card>}</Index>
      <Inline><Button size="sm" disabled={full()}
        onPress={() => change(current => ({ ...current, actions: { ...current.actions, buttons: [...current.actions?.buttons ?? [], { kind: 'open', label: 'Open', reference: { kind: 'record', prefer: 'refPanel' } }] } }))}>Add button</Button></Inline>
      <Show when={full()}><Text emphasis="muted">A row has at most three buttons.</Text></Show>
    </Stack></Field>
  </Stack>
}

/** How often the panel reads its sources again. Automatic leaves `refresh` unset. */
const REFRESH_OPTIONS = [
  { value: '', label: 'Automatic' }, { value: '60', label: 'Every minute' }, { value: '300', label: 'Every 5 minutes' },
  { value: '900', label: 'Every 15 minutes' }, { value: '3600', label: 'Every hour' }, { value: '86400', label: 'Every day' },
]

function SettingsInspector(props: InspectorProps) {
  const { change, plan } = props.context
  const refreshOptions = () => {
    const stored = plan().refresh === undefined ? '' : String(plan().refresh)
    return REFRESH_OPTIONS.some(option => option.value === stored) ? REFRESH_OPTIONS : [...REFRESH_OPTIONS, { value: stored, label: `Every ${plural(Number(stored), 'second')}` }]
  }
  return <Stack gap="row">
    <LabeledSelect label="Refresh" value={plan().refresh === undefined ? '' : String(plan().refresh)} options={refreshOptions()}
      onChange={value => change(current => value ? { ...current, refresh: Number(value) } : without(current, 'refresh'))} />
    <LabeledSelect label="Time zone" value={plan().time.zone} options={timezoneOptions(plan().time.zone)} onChange={zone => change(current => ({ ...current, time: { ...current.time, zone } }))} />
    <LabeledSelect label="Dates show in" value={plan().time.mode} options={labelOptions(TIME_MODE_LABELS)} onChange={mode => change(current => ({ ...current, time: { ...current.time, mode: mode as 'fixed' | 'viewer' } }))} />
    <LabeledSelect label="Weeks start on" value={plan().time.weekStart} options={labelOptions(WEEK_START_LABELS)} onChange={weekStart => change(current => ({ ...current, time: { ...current.time, weekStart: weekStart as PanelPlan['time']['weekStart'] } }))} />
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
