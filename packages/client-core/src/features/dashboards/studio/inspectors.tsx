import { createMemo, createSignal, For, Index, Show, type Component } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { dashboardFields } from '@acorn/dashboards-core/projection'
import {
  newColumnId,
  outputPlanColumns,
  type DashboardRun,
  type PlanProblem,
  type SourceFailure,
} from '@acorn/dashboards-core/plan.ts'
import { PANEL_CAPABILITIES } from '@acorn/dashboards-core/capabilities.ts'
import {
  AGGREGATE_LABELS,
  BUCKET_LABELS,
  CHART_SHAPE_LABELS,
  COLUMN_TYPE_LABELS,
  COMPARE_LABELS,
  EMPTY_SORT_LABELS,
  GOOD_DIRECTION_LABELS,
  GROUP_ORDER_LABELS,
  PRECISION_LABELS,
  SOURCE_ROLE_LABELS,
  TIME_MODE_LABELS,
  TONE_LABELS,
  TREND_LABELS,
  UNIT_LABELS,
  UNMATCHED_LABELS,
  WEEK_START_LABELS,
  OPERATION_HELP,
  VIEW_HELP,
  labelOptions,
  sortDirectionLabel,
} from '@acorn/dashboards-core/labels.ts'
import {
  availableViews,
  countsByPart,
  planSummary,
  problemsByPart,
  SOURCE_ICON,
  switchView,
  VIEW_ICONS,
  type PlanInputs,
  type PlanPartKey,
} from '@acorn/dashboards-core/outline.ts'
import type { SourceQueryEditorState } from '../../dataSources/SourceQueryEditor'
import SourceQueryEditor from '../../dataSources/SourceQueryEditor'
import { Alert, Button, Card, Checkbox, Chip, Field, Row } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { Rows } from '../../../kit/components/layout/Rows'
import { RowActions } from '../../../kit/components/layout/RowActions'
import { Stack } from '../../../kit/components/layout/Stack'
import Icon from '../../../kit/components/content/Icon'
import { Text } from '../../../kit/components/content/Text'
import IconPicker from '../../../kit/components/inputs/IconPicker'
import Picker from '../../../kit/components/inputs/Picker'
import { Menu } from '../../../kit/components/overlays/Menu'
import { availableContentPresentations } from '../../../host/registries/panes/contentLinks'
import EquivalenceForm from '../EquivalenceForm'
import KeepHistory from '../KeepHistory'
import WriteValueControls from '../WriteValueControls'
import { bindColumnField } from '../dashboardEditorModel'
import { LabeledInput, LabeledSelect } from '../fields'
import { regionRefusal, type PanelRegion } from '../region'
import type { FailureContext } from '../planInputs'
import SourceFailureAlert, { openPluginSettings } from '../SourceFailureAlert'
import { operationForms } from './operationForms'
import { wholeNumber, type Stage, type StageFormProps } from './stageFormParts'
import type { StudioChangeOptions } from './studioStore'
import {
  addButtonTo,
  addChoiceTo,
  addColumnTo,
  addDeclaredRelationTo,
  addFieldColumnTo,
  addGroupTo,
  addRelationTo,
  addSortTo,
  describeSourceIn,
  editButtonIn,
  editChoiceIn,
  editColumnIn,
  editGroupIn,
  editSortIn,
  editTimeIn,
  editViewIn,
  mapSourceValue,
  moveColumnIn,
  NEW_COLUMN,
  pressFromChoice,
  regroupByColumn,
  removeButtonFrom,
  removeChoiceFrom,
  removeColumnFrom,
  removeGroupFrom,
  removeRelationFrom,
  removeSortFrom,
  removeStageFrom,
  replaceStageIn,
  retypeColumn,
  setButtonJob,
  setButtonOpens,
  setButtonPresentation,
  setChoiceRank,
  setChoiceWriteValue,
  setColumnHidden,
  setColumnUnit,
  setLimitIn,
  setPressIn,
  setRefreshIn,
  setRelationUnmatched,
  setSourceReference,
  setSourceRole,
  setStatAggregate,
  swap,
  without,
} from './planEdits'

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
  return (current && !zones.includes(current) ? [current, ...zones] : zones).map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
  }))
}
const presentationOptions = [
  { value: 'refPanel', label: 'Side panel' },
  { value: 'pane', label: 'Task pane' },
  { value: 'route', label: 'Full page' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'external', label: 'Browser' },
]
const columnOptions = (columns: readonly Column[]) =>
  columns.map((column) => ({ value: column.id, label: column.label }))
const sourceLabel = (plan: PanelPlan, id: string): string =>
  plan.sources.find((source) => source.id === id)?.label ?? id
/** Each source's description by source id, from what its picker last reported. */
const sourceDescriptions = (tracking: SourceTracking): Record<string, DataSourceDescription | undefined> =>
  Object.fromEntries(Object.entries(tracking.states()).map(([id, state]) => [id, state?.description]))
// ── Sources ────────────────────────────────────────────────────────────────────────────────────

export type SourceTracking = ReturnType<typeof createSourceTracking>

/** The starter with every source that reads the same source as `picked` moved onto its scope: the
 *  workspace, account, and reach the person chose. A starter carries no account of its own. */
export function starterForPick(starter: PanelPlan, picked: Pick<DataSourceQuery, 'source' | 'scope'>): PanelPlan {
  const same = (query: DataSourceQuery) =>
    query.source.pluginId === picked.source.pluginId && query.source.sourceId === picked.source.sourceId
  return {
    ...starter,
    sources: starter.sources.map((entry) =>
      entry.reference.kind !== 'inline' || !same(entry.reference.content.query)
        ? entry
        : {
            ...entry,
            reference: {
              ...entry.reference,
              content: { ...entry.reference.content, query: { ...entry.reference.content.query, scope: picked.scope } },
            },
          },
    ),
  }
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
  const candidates = plain.flatMap((candidate) => {
    const parsed = panelPlanSchema.safeParse(candidate)
    return parsed.success ? [starterForPick(parsed.data, picked)] : []
  })
  const checked = await Promise.all(
    candidates.map((plan) =>
      validate(plan).then(
        (result) => (result.problems.length ? undefined : plan),
        () => undefined,
      ),
    ),
  )
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
    setStates((current) => ({ ...current, [id]: state }))
    if (!state.description || !state.query) return
    const describedSource = `${state.query.source.pluginId}/${state.query.source.sourceId}`
    const priorSource = describedSources.get(id)
    describedSources.set(id, describedSource)
    if (priorRevision !== state.description.revision)
      void checkedStarters(state.description, state.query, input.validate).then((plans) =>
        setStarters((current) => ({ ...current, [id]: plans })),
      )
    const available = dashboardFields(state.description)
    // Columns bound to the old source's fields would point at fields the new source doesn't have.
    const switched = priorSource !== undefined && priorSource !== describedSource
    input.change(
      (current) => describeSourceIn(current, id, { name: state.source?.name, switched, fields: available }),
      {
        derived: true,
      },
    )
  }
  return { states, starters, report }
}

/** Source, account, reach, and scope come from the picker. Then how a second source joins, the
 *  source's starter plans, and the source-level actions. */
export function SourceInspector(props: InspectorProps) {
  const context = props.context
  const id = () => props.part.slice('source:'.length)
  const source = () => context.plan().sources.find((entry) => entry.id === id())
  const state = () => context.sources.states()[id()]
  const setReference = (reference: QueryReference | undefined): void =>
    context.change((current) => setSourceReference(current, id(), reference))
  const starterPlans = () => context.sources.starters()[id()] ?? []
  // The source's own problems and its inputs', each in plain words with its fix. Choosing an account
  // happens in the picker below, so that fix isn't repeated here.
  const failures = createMemo(() => {
    const grouped = problemsByPart(context.plan(), context.problems(), context.inputs())
    return Object.entries(grouped).flatMap(([key, problems]) =>
      key === `source:${id()}` || key.startsWith(`input:${id()}:`) ? (problems ?? []) : [],
    )
  })
  return (
    <Show when={source()}>
      {(current) => (
        <Stack gap="row">
          <For each={failures()}>
            {(problem) => (
              <Show when={problem.failure} fallback={<Alert tone="warn">{problem.message}</Alert>}>
                {(failure) => (
                  <SourceFailureAlert
                    failure={failure()}
                    context={context.failureContext({ ...problem, failure: failure() })}
                    severity={problem.severity}
                  />
                )}
              </Show>
            )}
          </For>
          <SourceQueryEditor
            workspaceId={context.workspaceId}
            value={current().reference}
            hideAuthoring
            hideConditions
            hidePreview
            pickSourceAccount
            onChange={setReference}
            onStateChange={(next) => context.sources.report(id(), next)}
          />
          <Show when={context.plan().sources.length > 1}>
            <LabeledSelect
              label="How it joins"
              value={current().role}
              options={labelOptions(SOURCE_ROLE_LABELS)}
              onChange={(role) =>
                context.change((plan) => setSourceRole(plan, id(), role as PanelPlan['sources'][number]['role']))
              }
            />
          </Show>
          <Show when={starterPlans().length}>
            <Field
              label="Start over from a starter panel"
              hint="Replaces everything in this panel. Undo brings it back."
              group
            >
              <Inline gap="inline" wrap>
                <For each={starterPlans()}>
                  {(starter) => (
                    <Button size="sm" tip={planSummary(starter)} onPress={() => context.change(() => starter)}>
                      {starter.title}
                    </Button>
                  )}
                </For>
              </Inline>
            </Field>
          </Show>
          <Inline gap="inline" wrap>
            <Show when={state()?.query && state()?.description && state()?.source}>
              <KeepHistory
                query={state()!.query!}
                description={state()!.description!}
                sourceName={state()!.source!.name}
                onCreated={context.refreshQueries}
              />
            </Show>
            <Show when={state()?.source?.inputs && state()!.source!.pluginId}>
              {(plugin) => (
                <Button size="sm" variant="ghost" onPress={() => openPluginSettings(plugin())}>
                  About this source
                </Button>
              )}
            </Show>
            <Button size="sm" variant="ghost" onPress={() => setReference(undefined)}>
              Remove source
            </Button>
          </Inline>
        </Stack>
      )}
    </Show>
  )
}

/** The picker for a source the plan doesn't have yet. The source joins the plan when one is picked:
 *  a placeholder source made the preview report it unavailable before anything was chosen. */
export function NewSourceInspector(props: {
  workspaceId: string
  onPick: (reference: QueryReference) => void
  onCancel?: () => void
}) {
  return (
    <Stack gap="row">
      <SourceQueryEditor
        workspaceId={props.workspaceId}
        hideAuthoring
        hideConditions
        hidePreview
        pickSourceAccount
        onChange={(reference) => reference && props.onPick(reference)}
      />
      <Show when={props.onCancel}>
        {(cancel) => (
          <Button size="sm" variant="bare" onPress={cancel()}>
            Cancel
          </Button>
        )}
      </Show>
    </Stack>
  )
}

function RelationsInspector(props: InspectorProps) {
  const context = props.context
  const plan = context.plan
  const states = context.sources.states
  const addDeclaredRelation = (
    from: string,
    to: string,
    declared: NonNullable<DataSourceDescription['relations']>[number],
  ): void => {
    const output = declared.cardinality === 'one-to-many' ? newColumnId(plan(), declared.label) : undefined
    context.change((current) => addDeclaredRelationTo(current, { from, to, declared, output }))
  }
  return (
    <Stack gap="row">
      <EquivalenceForm
        sources={plan().sources}
        columns={plan().columns}
        onAdd={(relation) => context.change((current) => addRelationTo(current, relation))}
      />
      <For each={plan().relations ?? []}>
        {(relation, index) => (
          <Card>
            <Stack gap="row">
              <Text>
                {`${sourceLabel(plan(), relation.from)} ${relation.kind.replaceAll('-', ' ')} ` +
                  sourceLabel(plan(), relation.to)}
              </Text>
              <LabeledSelect
                label="Unmatched rows"
                value={relation.unmatched}
                options={[
                  { value: 'keep', label: 'Keep' },
                  { value: 'drop', label: 'Drop' },
                ]}
                onChange={(unmatched) =>
                  context.change((current) => setRelationUnmatched(current, index(), unmatched as 'keep' | 'drop'))
                }
              />
              <Button
                size="sm"
                variant="bare"
                onPress={() => context.change((current) => removeRelationFrom(current, index()))}
              >
                Remove relation
              </Button>
            </Stack>
          </Card>
        )}
      </For>
      <For each={plan().sources}>
        {(from) => (
          <For each={states()[from.id]?.description?.relations ?? []}>
            {(declared) => (
              <For
                each={plan().sources.filter(
                  (to) =>
                    to.id !== from.id &&
                    states()[to.id]?.source?.pluginId === declared.target.pluginId &&
                    states()[to.id]?.source?.sourceId === declared.target.sourceId,
                )}
              >
                {(to) => (
                  <Button
                    size="sm"
                    disabled={(plan().relations ?? []).some(
                      (relation) => relation.id === declared.id && relation.from === from.id && relation.to === to.id,
                    )}
                    onPress={() => addDeclaredRelation(from.id, to.id, declared)}
                  >{`Add ${declared.label}: ${from.label} to ${to.label}`}</Button>
                )}
              </For>
            )}
          </For>
        )}
      </For>
    </Stack>
  )
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
      const field = context.sources.states()[source.id]?.description?.fields.find((entry) => entry.pointer === pointer)
      return field ? `From ${field.label}` : 'Its field is missing'
    }
    return 'Not read from a source'
  }
  const items = () => plan().columns.map((column, index) => ({ key: column.id, column, index }))
  const shownItems = () => items().filter((item) => !item.column.hidden)
  const hiddenItems = () => items().filter((item) => item.column.hidden)
  // Move up and down step through the plan's full column list, hidden ones included, so a step can pass
  // a hidden column without anything moving in either section.
  const columnRows = (id: string, label: string, rows: ReturnType<typeof items>) => (
    <Rows
      id={id}
      ariaLabel={label}
      items={rows}
      selected={null}
      onSelect={(key) => context.select(`column:${key}`)}
      onActivate={(key) => context.select(`column:${key}`)}
    >
      {(item, itemProps, selected) => (
        <Row
          item={itemProps}
          selected={selected()}
          density="compact"
          variant="stacked"
          onPress={() => context.select(`column:${item.column.id}`)}
          meta={
            <Text emphasis="muted">
              {item.column.list
                ? `List of ${COLUMN_TYPE_LABELS[item.column.type ?? 'text'].toLowerCase()}`
                : COLUMN_TYPE_LABELS[item.column.type ?? 'text']}
            </Text>
          }
          trailing={
            <RowActions ariaLabel={`Actions for ${item.column.label}`}>
              {(menu) => (
                <>
                  <Menu.Item
                    context={menu}
                    disabled={item.index === 0}
                    onSelect={() => context.change((current) => moveColumnIn(current, item.index, -1))}
                  >
                    Move up
                  </Menu.Item>
                  <Menu.Item
                    context={menu}
                    disabled={item.index === plan().columns.length - 1}
                    onSelect={() => context.change((current) => moveColumnIn(current, item.index, 1))}
                  >
                    Move down
                  </Menu.Item>
                  <Menu.Item
                    context={menu}
                    onSelect={() =>
                      context.change((current) => setColumnHidden(current, item.column.id, !item.column.hidden))
                    }
                  >
                    {item.column.hidden ? 'Show' : 'Hide'}
                  </Menu.Item>
                  <Menu.Item
                    context={menu}
                    tone="danger"
                    onSelect={() => context.change((current) => removeColumnFrom(current, item.column.id))}
                  >
                    Remove
                  </Menu.Item>
                  <Menu.Item context={menu} onSelect={() => context.askAi(`column:${item.column.id}`)}>
                    Ask AI about this
                  </Menu.Item>
                </>
              )}
            </RowActions>
          }
        >
          <Stack gap="none">
            <Text>{item.column.label}</Text>
            <Text emphasis="muted">{fieldLabel(item.column)}</Text>
          </Stack>
        </Row>
      )}
    </Rows>
  )
  /** Each source's fields that no column reads yet, so one pick makes a named, typed column. */
  const unusedFields = () =>
    plan().sources.flatMap((source) => {
      const description = context.sources.states()[source.id]?.description
      const used = new Set(plan().columns.flatMap((column) => boundField(column, source.id) ?? []))
      return description
        ? dashboardFields(description)
            .filter((field) => !used.has(field.id))
            .map((field) => ({ source, field }))
        : []
    })
  const addField = (id: string): void => {
    const picked = unusedFields().find((entry) => JSON.stringify([entry.source.id, entry.field.id]) === id)
    if (!picked) {
      context.change(addColumnTo)
      context.select(`column:${plan().columns.at(-1)!.id}`)
      return
    }
    context.change((current) => addFieldColumnTo(current, picked.source.id, picked.field))
  }
  return (
    <Stack gap="row">
      {columnRows('dashboards.studio.columns', 'Columns', shownItems())}
      <Inline>
        <Picker
          label="Add a field"
          ariaLabel="Add a field as a column"
          size="sm"
          placeholder="Search fields"
          emptyText="Every field is already a column."
          items={[
            ...unusedFields().map(({ source, field }) => ({
              id: JSON.stringify([source.id, field.id]),
              label: field.name,
              note:
                plan().sources.length > 1
                  ? `${COLUMN_TYPE_LABELS[field.type]} · ${source.label}`
                  : COLUMN_TYPE_LABELS[field.type],
            })),
            { id: 'empty', label: 'Empty column', note: 'Name it and choose its field yourself' },
          ]}
          onPick={addField}
        />
      </Inline>
      <Show when={hiddenItems().length}>
        <Field
          label="Hidden"
          hint="Left out of tables and lists. Sort, group, boards, and charts can still use them."
          group
        >
          {columnRows('dashboards.studio.columns.hidden', 'Hidden columns', hiddenItems())}
        </Field>
      </Show>
    </Stack>
  )
}

/** A number column's unit as one choice: a fixed unit, a currency, or another column. */
const unitChoice = (unit: Column['unit']): string =>
  unit === undefined ? '' : typeof unit === 'object' ? 'column' : unit in UNIT_LABELS ? unit : 'currency'

function ColumnInspector(props: InspectorProps) {
  const context = props.context
  const plan = context.plan
  const states = context.sources.states
  const columnId = () => props.part.slice('column:'.length)
  const column = () => plan().columns.find((entry) => entry.id === columnId())
  const editColumn = (update: (column: Column) => Column, options?: StudioChangeOptions): void =>
    context.change((current) => editColumnIn(current, columnId(), update), options)
  const editChoice = (index: number, update: (choice: Choice) => Choice, options?: StudioChangeOptions): void =>
    editColumn((entry) => editChoiceIn(entry, index, update), options)
  const bindColumn = (sourceId: string, pointer: string): void =>
    editColumn((entry) => {
      if (!pointer) return { ...entry, bind: without(entry.bind, sourceId) }
      const description = states()[sourceId]?.description
      return bindColumnField(entry, sourceId, pointer, description ? dashboardFields(description) : [], NEW_COLUMN)
    })
  const problems = () => problemsByPart(plan(), context.problems())[props.part] ?? []
  /** One source's fields, those of a compatible type first, each with its type. */
  const fieldOptions = (sourceId: string) => {
    const current = column()!
    const fields = states()[sourceId]?.description?.fields ?? []
    const fits = (field: (typeof fields)[number]) => !current.type || fieldType(field) === current.type
    const pointer = boundField(current, sourceId)
    const missing =
      pointer && !fields.some((field) => field.pointer === pointer)
        ? [{ value: pointer, label: `${pointer.slice(1).split('/').at(-1)} is missing, choose another` }]
        : []
    return [
      { value: '', label: plan().sources.length > 1 ? 'Not from this source' : 'Choose a field' },
      ...missing,
      ...[...fields.filter(fits), ...fields.filter((field) => !fits(field))].map((field) => ({
        value: field.pointer,
        label: field.label,
        description: COLUMN_TYPE_LABELS[fieldType(field) ?? 'text'],
      })),
    ]
  }
  const suggestedBinding = (sourceId: string): { pointer: string; name: string } | undefined => {
    const current = column()!
    const description = states()[sourceId]?.description
    if (current.bind[sourceId] || !description) return undefined
    const fields = dashboardFields(description)
    const match =
      fields.find((field) => field.type === current.type && field.name.toLowerCase() === current.label.toLowerCase()) ??
      fields.find((field) => field.type === current.type && field.role === current.id)
    return match ? { pointer: match.id, name: match.name } : undefined
  }
  /** The values a source's choice field declares, for mapping each to one of the column's choices. */
  const sourceValues = (sourceId: string) => {
    const pointer = boundField(column()!, sourceId)
    const field = pointer ? states()[sourceId]?.description?.fields.find((item) => item.pointer === pointer) : undefined
    return field?.choices?.kind === 'static' ? field.choices.values : []
  }
  const mappedChoice = (sourceId: string, valueId: string): string => {
    const binding = column()!.bind[sourceId]
    return binding && 'field' in binding
      ? (Object.entries(binding.values ?? {}).find(([, ids]) => ids.includes(valueId))?.[0] ?? '')
      : ''
  }
  const mapChoice = (sourceId: string, valueId: string, choiceId: string): void =>
    editColumn((entry) => mapSourceValue(entry, sourceId, valueId, choiceId))
  const setUnit = (choice: string): void => editColumn((entry) => setColumnUnit(entry, choice, plan().columns))

  return (
    <Show when={column()}>
      {(current) => (
        <Stack gap="row">
          <For each={problems()}>{(problem) => <Alert tone="warn">{problem.message}</Alert>}</For>
          {/* The field comes first, because picking it names and types a new column. */}
          <Field label={plan().sources.length > 1 ? 'Read from' : undefined} group>
            <Stack gap="row">
              <For each={plan().sources}>
                {(source) => (
                  <>
                    <LabeledSelect
                      label={plan().sources.length > 1 ? source.label : 'Field'}
                      value={boundField(current(), source.id) ?? ''}
                      options={fieldOptions(source.id)}
                      onChange={(pointer) => bindColumn(source.id, pointer)}
                    />
                    <Show when={suggestedBinding(source.id)}>
                      {(suggestion) => (
                        <Inline>
                          <Chip
                            onPress={() => bindColumn(source.id, suggestion().pointer)}
                            leading={<Icon name="sparkles" />}
                          >{`Use ${suggestion().name}`}</Chip>
                        </Inline>
                      )}
                    </Show>
                  </>
                )}
              </For>
            </Stack>
          </Field>
          <LabeledInput
            label="Name"
            value={current().label}
            onInput={(label) => editColumn((entry) => ({ ...entry, label }), { coalesce: true })}
          />
          <LabeledSelect
            label="Type"
            value={current().type ?? 'text'}
            options={labelOptions(COLUMN_TYPE_LABELS)}
            onChange={(type) => editColumn((entry) => retypeColumn(entry, type as NonNullable<Column['type']>))}
          />

          <Show when={current().type === 'number'}>
            <LabeledSelect
              label="Unit"
              value={unitChoice(current().unit)}
              options={[
                { value: '', label: 'None' },
                ...labelOptions(UNIT_LABELS),
                { value: 'currency', label: 'Currency' },
                { value: 'column', label: 'Read the unit from another column' },
              ]}
              onChange={setUnit}
            />
            <Show when={unitChoice(current().unit) === 'currency'}>
              <LabeledInput
                label="Currency code"
                hint="Three letters, such as USD"
                maxLength={3}
                value={String(current().unit ?? '')}
                onInput={(code) =>
                  editColumn(
                    (entry) => (code.trim() ? { ...entry, unit: code.trim().toUpperCase() } : without(entry, 'unit')),
                    { coalesce: true },
                  )
                }
              />
            </Show>
            <Show when={typeof current().unit === 'object' ? (current().unit as { column: string }) : undefined}>
              {(unit) => (
                <LabeledSelect
                  label="Unit column"
                  value={unit().column}
                  options={columnOptions(plan().columns.filter((entry) => entry.id !== current().id))}
                  onChange={(unitColumn) => editColumn((entry) => ({ ...entry, unit: { column: unitColumn } }))}
                />
              )}
            </Show>
          </Show>
          <Show when={current().type === 'datetime'}>
            <LabeledSelect
              label="Show as"
              value={current().precision ?? 'instant'}
              options={labelOptions(PRECISION_LABELS)}
              onChange={(precision) =>
                editColumn((entry) =>
                  precision === 'day' ? { ...entry, precision: 'day' } : without(entry, 'precision'),
                )
              }
            />
          </Show>
          <Show when={current().type === 'enum'}>
            <Field label="Choices" group>
              <Stack gap="row">
                <Index each={current().choices ?? []}>
                  {(choice, index) => (
                    <div class="dash-studio-choice">
                      <LabeledInput
                        label="Name"
                        value={choice().label}
                        onInput={(label) => editChoice(index, (value) => ({ ...value, label }), { coalesce: true })}
                      />
                      <LabeledSelect
                        label="Colour"
                        value={choice().tone ?? 'muted'}
                        options={labelOptions(TONE_LABELS)}
                        onChange={(tone) =>
                          editChoice(index, (value) => ({ ...value, tone: tone as NonNullable<Choice['tone']> }))
                        }
                      />
                      <LabeledInput
                        label="Order"
                        type="number"
                        value={String(choice().rank ?? '')}
                        onInput={(rank) => editChoice(index, (value) => setChoiceRank(value, rank), { coalesce: true })}
                      />
                      <WriteValueControls
                        column={current()}
                        choice={choice()}
                        sources={plan().sources}
                        descriptions={sourceDescriptions(context.sources)}
                        onChange={(sourceId, value, present) =>
                          editChoice(index, (candidate) => setChoiceWriteValue(candidate, sourceId, value, present))
                        }
                      />
                      <Inline>
                        <Button
                          size="sm"
                          variant="bare"
                          onPress={() => editColumn((entry) => removeChoiceFrom(entry, index))}
                        >
                          Remove choice
                        </Button>
                      </Inline>
                    </div>
                  )}
                </Index>
                <Inline>
                  <Button size="sm" onPress={() => editColumn(addChoiceTo)}>
                    Add choice
                  </Button>
                </Inline>
              </Stack>
            </Field>
            <For each={plan().sources.filter((source) => sourceValues(source.id).length)}>
              {(source) => (
                <Field label={plan().sources.length > 1 ? `${source.label} values` : 'Source values'} group>
                  <Stack gap="row">
                    <For each={sourceValues(source.id)}>
                      {(value) => (
                        <LabeledSelect
                          label={value.label}
                          value={mappedChoice(source.id, value.id)}
                          options={[
                            { value: '', label: 'Not listed' },
                            ...(current().choices ?? []).map((choice) => ({ value: choice.id, label: choice.label })),
                          ]}
                          onChange={(choiceId) => mapChoice(source.id, value.id, choiceId)}
                        />
                      )}
                    </For>
                  </Stack>
                </Field>
              )}
            </For>
            <LabeledSelect
              label="Values not listed"
              value={current().unmatched ?? 'catch-all'}
              options={labelOptions(UNMATCHED_LABELS)}
              onChange={(unmatched) =>
                editColumn((entry) => ({ ...entry, unmatched: unmatched as NonNullable<Column['unmatched']> }))
              }
            />
          </Show>
          <Checkbox
            label="Holds a list of values"
            checked={!!current().list}
            onChange={(list) => editColumn((entry) => (list ? { ...entry, list } : without(entry, 'list')))}
          />
          <Show when={plan().relations?.some((relation) => relation.kind === 'equivalence')}>
            <LabeledSelect
              label="Prefer the value from"
              value={current().precedence?.[0] ?? ''}
              options={[
                { value: '', label: 'Whichever has one' },
                ...plan()
                  .sources.filter((source) => source.role === 'primary')
                  .map((source) => ({ value: source.id, label: source.label })),
              ]}
              onChange={(sourceId) =>
                editColumn((entry) => (sourceId ? { ...entry, precedence: [sourceId] } : without(entry, 'precedence')))
              }
            />
          </Show>
        </Stack>
      )}
    </Show>
  )
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
    context.change((current) => replaceStageIn(current, index(), next), options)
  // Each form takes its own operation's step. The registry is typed per operation, which `Dynamic`
  // can't follow, so the form is read here as one that takes any step.
  const form = () => operationForms[stage()!.op] as unknown as Component<StageFormProps>
  return (
    <Show when={stage()}>
      {(current) => (
        <Stack gap="row">
          <Dynamic
            component={form()}
            stage={current()}
            columns={columns()}
            plan={plan()}
            sources={descriptions()}
            onChange={change}
          />
          <Show when={count()}>
            {(counted) => (
              <Text emphasis="muted">
                {`${plural(counted().input, 'row')} in · ${plural(counted().output, 'row')} out`}
              </Text>
            )}
          </Show>
          <For each={problems()}>{(problem) => <Alert tone="warn">{problem.message}</Alert>}</For>
          <Inline>
            <Button
              size="sm"
              variant="bare"
              onPress={() => context.change((current) => removeStageFrom(current, index()))}
            >
              Remove step
            </Button>
          </Inline>
        </Stack>
      )}
    </Show>
  )
}

// ── Arrange, look, behaviour, settings ───────────────────────────────────────────────────────────

type Sort = NonNullable<PanelPlan['sort']>[number]
type Group = NonNullable<PanelPlan['group']>[number]

function ArrangeInspector(props: InspectorProps) {
  const { change, plan, run } = props.context
  const columns = createMemo(() => outputPlanColumns(plan()))
  const typeOf = (id: string) => columns().find((column) => column.id === id)?.type
  const editSort = (index: number, update: (sort: Sort) => Sort) =>
    change((current) => editSortIn(current, index, update))
  const editGroup = (index: number, update: (group: Group) => Group) =>
    change((current) => editGroupIn(current, index, update))
  /** The group keys a custom order lists: stored ones first, then the column's choices and the groups
   *  the last run made at this level. A key is the raw value, so a choice shows by its label. */
  const groupKeys = (group: Group, index: number): string[] => {
    const groups = run()?.groups ?? []
    const made = index === 0 ? groups : groups.flatMap((entry) => entry.children ?? [])
    return [
      ...new Set([
        ...(group.values ?? []),
        ...(columns()
          .find((column) => column.id === group.column)
          ?.choices?.map((choice) => choice.id) ?? []),
        ...made.map((entry) => entry.key),
      ]),
    ]
  }
  const keyLabel = (group: Group, key: string) =>
    columns()
      .find((column) => column.id === group.column)
      ?.choices?.find((choice) => choice.id === key)?.label ?? key
  const moveValue = (index: number, at: number, by: -1 | 1) =>
    editGroup(index, (group) => ({ ...group, values: swap(groupKeys(group, index), at, by) ?? group.values }))
  const pickGroupColumn = (index: number, column: string) =>
    editGroup(index, (group) => regroupByColumn(group, column, typeOf(column)))
  return (
    <Stack gap="stack">
      <Field label="Sort by" group>
        <Stack gap="row">
          <Index each={plan().sort ?? []}>
            {(sort, index) => (
              <div class="dash-studio-condition">
                <LabeledSelect
                  label="Column"
                  value={sort().column}
                  options={columnOptions(columns())}
                  onChange={(column) => editSort(index, (entry) => ({ ...entry, column }))}
                />
                <LabeledSelect
                  label="Order"
                  value={sort().direction}
                  options={(['desc', 'asc'] as const).map((direction) => {
                    const words = sortDirectionLabel(direction, typeOf(sort().column))
                    return { value: direction, label: words[0]!.toUpperCase() + words.slice(1) }
                  })}
                  onChange={(direction) =>
                    editSort(index, (entry) => ({ ...entry, direction: direction as Sort['direction'] }))
                  }
                />
                <LabeledSelect
                  label="Empty values"
                  value={sort().empty ?? 'last'}
                  options={labelOptions(EMPTY_SORT_LABELS)}
                  onChange={(empty) =>
                    editSort(index, (entry) => ({ ...entry, empty: empty as NonNullable<Sort['empty']> }))
                  }
                />
                <Inline>
                  <Button size="sm" variant="bare" onPress={() => change((current) => removeSortFrom(current, index))}>
                    Remove
                  </Button>
                </Inline>
              </div>
            )}
          </Index>
          <Inline>
            <Button
              size="sm"
              disabled={(plan().sort?.length ?? 0) >= 8 || !columns().length}
              onPress={() => change((current) => addSortTo(current, columns()[0]!.id))}
            >
              Add sort
            </Button>
          </Inline>
        </Stack>
      </Field>
      <Field label="Group by" group>
        <Stack gap="row">
          <Index each={plan().group ?? []}>
            {(group, index) => (
              <div class="dash-studio-condition">
                <LabeledSelect
                  label="Column"
                  value={group().column}
                  options={columnOptions(columns())}
                  onChange={(column) => pickGroupColumn(index, column)}
                />
                <Show when={typeOf(group().column) === 'datetime'}>
                  <LabeledSelect
                    label="Group"
                    value={group().bucket ?? 'value'}
                    options={labelOptions(BUCKET_LABELS)}
                    onChange={(bucket) =>
                      editGroup(index, (entry) =>
                        bucket === 'value' ? without(entry, 'bucket') : { ...entry, bucket: bucket as Group['bucket'] },
                      )
                    }
                  />
                </Show>
                <LabeledSelect
                  label="Order groups by"
                  value={group().order ?? 'declared'}
                  options={labelOptions(GROUP_ORDER_LABELS)}
                  onChange={(order) =>
                    editGroup(index, (entry) =>
                      order === 'explicit'
                        ? { ...entry, order, values: groupKeys(entry, index) }
                        : { ...without(entry, 'values'), order: order as Group['order'] },
                    )
                  }
                />
                <Show when={group().order === 'explicit'}>
                  <Stack gap="none">
                    <Index each={group().values ?? []}>
                      {(value, at) => (
                        <Inline gap="inline">
                          <Text>{keyLabel(group(), value())}</Text>
                          <Button size="xs" variant="bare" disabled={at === 0} onPress={() => moveValue(index, at, -1)}>
                            Up
                          </Button>
                          <Button
                            size="xs"
                            variant="bare"
                            disabled={at === (group().values?.length ?? 0) - 1}
                            onPress={() => moveValue(index, at, 1)}
                          >
                            Down
                          </Button>
                        </Inline>
                      )}
                    </Index>
                  </Stack>
                </Show>
                <Inline>
                  <Button size="sm" variant="bare" onPress={() => change((current) => removeGroupFrom(current, index))}>
                    Remove
                  </Button>
                </Inline>
              </div>
            )}
          </Index>
          <Inline>
            <Button
              size="sm"
              disabled={(plan().group?.length ?? 0) >= 2 || !columns().length}
              onPress={() => change((current) => addGroupTo(current, columns()[0]!.id))}
            >
              Add grouping
            </Button>
          </Inline>
        </Stack>
      </Field>
      <LabeledInput
        label="Show at most"
        hint="Leave empty to show every row"
        type="number"
        min={1}
        max={5000}
        value={String(plan().limit ?? '')}
        onInput={(raw) => change((current) => setLimitIn(current, wholeNumber(raw)), { coalesce: true })}
      />
    </Stack>
  )
}

function LookInspector(props: InspectorProps) {
  const { change, plan, region } = props.context
  const view = () => plan().view
  const viewHas = (option: string): boolean =>
    (PANEL_CAPABILITIES.views[view().kind].options as readonly string[]).includes(option)
  const columns = createMemo(() => outputPlanColumns(plan()))
  const editView = (update: (view: PanelPlan['view']) => PanelPlan['view']) =>
    change((current) => editViewIn(current, update))
  const setOption = <K extends 'field' | 'x' | 'series' | 'trend' | 'compare' | 'good'>(key: K, value: string) =>
    editView((current) => (value ? { ...current, [key]: value } : (without(current, key) as PanelPlan['view'])))
  const views = () =>
    availableViews(plan()).map((entry) => {
      const refused = region ? regionRefusal(region, entry.id, {}) : undefined
      return { ...entry, available: entry.available && !refused, reason: entry.reason ?? refused }
    })
  const pickView = (kind: PanelPlan['view']['kind']) => change((current) => switchView(current, kind))
  const numberColumns = () => columns().filter((column) => column.type === 'number')
  // The stat's number as one choice: a count of rows, or a calculation over a column.
  const statNumber = () => (view().aggregate && view().aggregate !== 'count' ? view().aggregate! : 'count')
  // Each view with what it's for, or why the panel can't use it yet, so the choice reads without hovering.
  const viewItems = () =>
    views().map((entry) => ({ ...entry, key: entry.id, disabled: !entry.available && entry.id !== view().kind }))
  const pickListed = (key: string): void => {
    const entry = viewItems().find((item) => item.key === key)
    if (entry && !entry.disabled && entry.id !== view().kind) pickView(entry.id)
  }
  return (
    <Stack gap="row">
      <Field label="Show as" group>
        <Rows
          id="dashboards.studio.views"
          ariaLabel="Show as"
          items={viewItems()}
          selected={view().kind}
          onSelect={pickListed}
          onActivate={pickListed}
        >
          {(item, itemProps, selected) => (
            <Row
              item={itemProps}
              selected={selected()}
              density="compact"
              variant="stacked"
              leading={<Icon name={VIEW_ICONS[item.id]} />}
              onPress={() => pickListed(item.key)}
            >
              <Stack gap="none">
                <Text>{item.label}</Text>
                <Text emphasis="muted" wrap>
                  {item.disabled ? item.reason : VIEW_HELP[item.id]}
                </Text>
              </Stack>
            </Row>
          )}
        </Rows>
      </Field>
      <Show when={view().kind === 'stat'}>
        <LabeledSelect
          label="Number"
          value={statNumber()}
          options={[
            { value: 'count', label: 'Count of rows' },
            ...(['sum', 'avg', 'min', 'max'] as const).map((aggregate) => ({
              value: aggregate,
              label: `${AGGREGATE_LABELS[aggregate]} of a column`,
            })),
          ]}
          onChange={(aggregate) => editView((current) => setStatAggregate(current, aggregate, numberColumns()[0]?.id))}
        />
        <Show when={statNumber() !== 'count'}>
          <LabeledSelect
            label="Of"
            value={view().field ?? ''}
            options={[
              ...(view().field ? [] : [{ value: '', label: 'Choose a column' }]),
              ...columnOptions(numberColumns()),
            ]}
            onChange={(field) => setOption('field', field)}
          />
        </Show>
        <LabeledSelect
          label="Trend"
          value={view().trend ?? ''}
          options={[{ value: '', label: 'None' }, ...labelOptions(TREND_LABELS)]}
          onChange={(trend) => setOption('trend', trend)}
        />
        <LabeledSelect
          label="Compare with"
          value={view().compare ?? ''}
          options={[{ value: '', label: 'None' }, ...labelOptions(COMPARE_LABELS)]}
          onChange={(compare) => setOption('compare', compare)}
        />
        <LabeledSelect
          label="Good direction"
          value={view().good ?? ''}
          options={[{ value: '', label: 'Neither' }, ...labelOptions(GOOD_DIRECTION_LABELS)]}
          onChange={(good) => setOption('good', good)}
        />
      </Show>
      <Show when={viewHas('shape')}>
        <LabeledSelect
          label="Shape"
          value={view().shape ?? 'bar'}
          options={labelOptions(CHART_SHAPE_LABELS)}
          onChange={(shape) => editView((current) => ({ ...current, shape: shape as 'bar' | 'line' }))}
        />
        <LabeledSelect
          label="Across"
          value={view().x ?? ''}
          options={[
            ...(view().x ? [] : [{ value: '', label: 'Choose a column' }]),
            ...columnOptions(columns().filter((column) => column.type === 'datetime' || column.type === 'enum')),
          ]}
          onChange={(x) => setOption('x', x)}
        />
        <LabeledSelect
          label="Split by"
          value={view().series ?? ''}
          options={[{ value: '', label: 'Nothing' }, ...columnOptions(columns())]}
          onChange={(series) => setOption('series', series)}
        />
      </Show>
      <Show when={view().kind === 'board'}>
        <Text emphasis="muted" wrap>
          Board columns come from the first grouping.
        </Text>
      </Show>
    </Stack>
  )
}

function BehaviourInspector(props: InspectorProps) {
  const { change, plan, run } = props.context
  const editButton = (index: number, update: (button: RowButton) => RowButton, options?: StudioChangeOptions): void =>
    change((current) => editButtonIn(current, index, update), options)
  const setPress = (press: NonNullable<PanelPlan['actions']>['press'] | undefined) =>
    change((current) => setPressIn(current, press))
  const links = () => plan().columns.filter((column) => column.type === 'link')
  const pressPresentations = createMemo(() => {
    const selected = plan().actions?.press
    if (!selected) return []
    if (selected.kind === 'task') return run()?.rows.some((row) => row.taskId) ? ['pane', 'route'] : []
    const choices = (run()?.rows ?? []).flatMap((row) =>
      selected.kind === 'link'
        ? (() => {
            const value = row.values[selected.column ?? '']
            return typeof value === 'string' ? availableContentPresentations({ href: value, taskId: row.taskId }) : []
          })()
        : row.target
          ? availableContentPresentations({ kind: row.target.kind, item: row.target.item, taskId: row.taskId })
          : row.action?.verb === 'openUrl'
            ? availableContentPresentations({ href: row.action.url, taskId: row.taskId })
            : [],
    )
    return [...new Set(choices)]
  })
  const pressChoice = () => {
    const press = plan().actions?.press
    return !press ? '' : press.kind === 'link' ? `link:${press.column ?? ''}` : press.kind
  }
  const pickPress = (choice: string) => setPress(pressFromChoice(choice))
  const sourceActions = () =>
    (run()?.rows ?? [])
      .flatMap((row) => row.actions ?? [])
      .filter((action, index, all) => all.findIndex((item) => item.id === action.id) === index)
  const does = (button: RowButton) => (button.kind === 'action' ? `action:${button.actionId}` : button.kind)
  const pickDoes = (index: number, choice: string) => editButton(index, (button) => setButtonJob(button, choice))
  const opens = (button: Extract<RowButton, { kind: 'open' }>) =>
    button.reference.kind === 'link' ? `link:${button.reference.column ?? ''}` : button.reference.kind
  const full = () => (plan().actions?.buttons.length ?? 0) >= 3
  return (
    <Stack gap="stack">
      <Field label="When someone clicks a row" group>
        <Stack gap="row">
          <LabeledSelect
            label="Click"
            value={pressChoice()}
            options={[
              { value: '', label: "Use the source's default" },
              ...(run()?.rows.some((row) => !!row.action || !!row.target)
                ? [{ value: 'record', label: 'Open the record' }]
                : []),
              ...(run()?.rows.some((row) => !!row.taskId) ? [{ value: 'task', label: 'Open its task' }] : []),
              ...links().map((column) => ({ value: `link:${column.id}`, label: `Open a link from ${column.label}` })),
            ]}
            onChange={pickPress}
          />
          <Show when={plan().actions?.press}>
            {(press) => (
              <Show when={pressPresentations().length || press().prefer}>
                <LabeledSelect
                  label="Open in"
                  value={press().prefer}
                  options={presentationOptions.filter(
                    (option) => option.value === press().prefer || pressPresentations().includes(option.value),
                  )}
                  onChange={(prefer) => setPress({ ...press(), prefer: prefer as Presentation })}
                />
              </Show>
            )}
          </Show>
        </Stack>
      </Field>
      <Field label="Buttons on each row" group>
        <Stack gap="row">
          <Index each={plan().actions?.buttons ?? []}>
            {(button, index) => (
              <Card>
                <Stack gap="row">
                  <LabeledInput
                    label="Label"
                    value={button().label}
                    onInput={(label) => editButton(index, (entry) => ({ ...entry, label }), { coalesce: true })}
                  />
                  <Field label="Icon" group>
                    <IconPicker
                      ariaLabel="Icon"
                      value={button().icon ?? null}
                      fallback="mouse-pointer-click"
                      onSelect={(icon) =>
                        editButton(index, (entry) => (icon ? { ...entry, icon } : without(entry, 'icon')))
                      }
                    />
                  </Field>
                  <LabeledSelect
                    label="Does"
                    value={does(button())}
                    options={[
                      { value: 'open', label: 'Open' },
                      { value: 'createTask', label: 'Start a task' },
                      ...sourceActions().map((action) => ({ value: `action:${action.id}`, label: action.label })),
                      ...(button().kind === 'action' &&
                      !sourceActions().some((action) => `action:${action.id}` === does(button()))
                        ? [{ value: does(button()), label: button().label }]
                        : []),
                    ]}
                    onChange={(choice) => pickDoes(index, choice)}
                  />
                  <Show
                    when={button().kind === 'open' ? (button() as Extract<RowButton, { kind: 'open' }>) : undefined}
                  >
                    {(open) => (
                      <>
                        <LabeledSelect
                          label="Opens"
                          value={opens(open())}
                          options={[
                            { value: 'record', label: 'The record' },
                            { value: 'task', label: 'Its task' },
                            ...links().map((column) => ({
                              value: `link:${column.id}`,
                              label: `A link from ${column.label}`,
                            })),
                          ]}
                          onChange={(value) => editButton(index, (entry) => setButtonOpens(entry, value))}
                        />
                        <LabeledSelect
                          label="Open in"
                          value={open().reference.prefer}
                          options={presentationOptions}
                          onChange={(prefer) =>
                            editButton(index, (entry) => setButtonPresentation(entry, prefer as Presentation))
                          }
                        />
                      </>
                    )}
                  </Show>
                  <Inline>
                    <Button
                      size="sm"
                      variant="bare"
                      onPress={() => change((current) => removeButtonFrom(current, index))}
                    >
                      Remove button
                    </Button>
                  </Inline>
                </Stack>
              </Card>
            )}
          </Index>
          <Inline>
            <Button size="sm" disabled={full()} onPress={() => change(addButtonTo)}>
              Add button
            </Button>
          </Inline>
          <Show when={full()}>
            <Text emphasis="muted">A row has at most three buttons.</Text>
          </Show>
        </Stack>
      </Field>
    </Stack>
  )
}

/** How often the panel reads its sources again. Automatic leaves `refresh` unset. */
const REFRESH_OPTIONS = [
  { value: '', label: 'Automatic' },
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
  { value: '900', label: 'Every 15 minutes' },
  { value: '3600', label: 'Every hour' },
  { value: '86400', label: 'Every day' },
]

function SettingsInspector(props: InspectorProps) {
  const { change, plan } = props.context
  const refreshOptions = () => {
    const stored = plan().refresh === undefined ? '' : String(plan().refresh)
    return REFRESH_OPTIONS.some((option) => option.value === stored)
      ? REFRESH_OPTIONS
      : [...REFRESH_OPTIONS, { value: stored, label: `Every ${plural(Number(stored), 'second')}` }]
  }
  return (
    <Stack gap="row">
      <LabeledSelect
        label="Refresh"
        value={plan().refresh === undefined ? '' : String(plan().refresh)}
        options={refreshOptions()}
        onChange={(value) => change((current) => setRefreshIn(current, value))}
      />
      <LabeledSelect
        label="Dates show in"
        value={plan().time.mode}
        options={labelOptions(TIME_MODE_LABELS)}
        onChange={(mode) => change((current) => editTimeIn(current, { mode: mode as 'fixed' | 'viewer' }))}
      />
      {/* With each viewer's own zone, the stored zone only applies when nobody is looking, such as when
        the Node records a number's history. */}
      <LabeledSelect
        label="Time zone"
        value={plan().time.zone}
        options={timezoneOptions(plan().time.zone)}
        {...(plan().time.mode === 'viewer' ? { hint: 'Used when Acorn records history in the background.' } : {})}
        onChange={(zone) => change((current) => editTimeIn(current, { zone }))}
      />
      <LabeledSelect
        label="Weeks start on"
        value={plan().time.weekStart}
        options={labelOptions(WEEK_START_LABELS)}
        onChange={(weekStart) =>
          change((current) => editTimeIn(current, { weekStart: weekStart as PanelPlan['time']['weekStart'] }))
        }
      />
    </Stack>
  )
}

/** A part key's kind: `stage:2` is a `stage`. */
export const partKind = (key: PlanPartKey) => key.split(':')[0] as PartKind
type PartKind = 'source' | 'relations' | 'columns' | 'column' | 'stage' | 'arrange' | 'look' | 'behaviour' | 'settings'

/** Each kind of part's heading in the inspector, and the line under it that says what the part is for.
 *  A source, a column, and a step are headed by their own words; the rest by what they are, because
 *  their outline titles are summaries such as "Updated, newest first". */
const PART_GUIDE: Record<PartKind | 'input', { heading?: string; help: string }> = {
  source: { help: 'Where the rows come from, and the account that reads them.' },
  input: { help: 'A source this one reads for you. Choose the account it uses.' },
  relations: {
    heading: 'How the sources join',
    help: 'How rows from each source match up, so their values end up on one row.',
  },
  columns: { heading: 'Columns', help: 'The values each row shows. Steps, sorting, and the view all work with these.' },
  column: { help: 'One value on each row, read from a field of the source.' },
  stage: { help: '' },
  arrange: { heading: 'Sort and group', help: 'Puts the rows in order, groups them, and limits how many show.' },
  look: { heading: 'Look', help: 'How the rows are drawn on the dashboard.' },
  behaviour: {
    heading: 'Clicks and buttons',
    help: 'What happens when someone clicks a row, and the buttons each row shows.',
  },
  settings: { heading: 'Settings', help: 'How often the panel reads its data again, and how it shows dates.' },
}

/** The inspector's heading and help line for a part. A step's help is its operation's. */
export function inspectorIntro(
  plan: PanelPlan,
  part: { key: PlanPartKey; title: string },
): { heading: string; help: string } {
  const kind = partKind(part.key) as keyof typeof PART_GUIDE
  const stage = kind === 'stage' ? plan.stages[Number(part.key.slice('stage:'.length))] : undefined
  return {
    heading: PART_GUIDE[kind].heading ?? part.title,
    help: stage ? OPERATION_HELP[stage.op] : PART_GUIDE[kind].help,
  }
}

/** The inspector with nothing selected: a panel's parts in the order they apply, each opening its part,
 *  so someone building their first panel learns the outline from one read. */
export function PanelGuide(props: { plan: PanelPlan; onSelect: (key: PlanPartKey) => void }) {
  const items = () => {
    const firstSource = props.plan.sources[0]
    const hasSteps = props.plan.stages.length > 0
    return [
      {
        key: firstSource ? `source:${firstSource.id}` : 'data',
        label: 'Data',
        icon: SOURCE_ICON,
        help: 'Where the rows come from.',
        disabled: !firstSource,
      },
      { key: 'columns', label: 'Columns', icon: 'columns-3', help: 'The values each row shows.' },
      {
        key: hasSteps ? 'stage:0' : 'steps',
        label: 'Steps',
        icon: 'list-filter',
        disabled: !hasSteps,
        help: hasSteps
          ? 'Filter, calculate, or summarize the rows.'
          : 'Optional. Use Add to filter, calculate, or summarize the rows.',
      },
      { key: 'arrange', label: 'Arrange', icon: 'arrow-up-down', help: 'Sort, group, and limit the rows.' },
      {
        key: 'look',
        label: 'Look',
        icon: VIEW_ICONS[props.plan.view.kind],
        help: 'A list, table, board, number, or chart, and what a click does.',
      },
    ]
  }
  const open = (key: string): void => {
    if (items().some((item) => item.key === key && !item.disabled)) props.onSelect(key as PlanPartKey)
  }
  return (
    <Stack gap="row">
      <Text wrap>A panel reads rows from a source, then shapes them in this order. Select a part to change it.</Text>
      <Rows
        id="dashboards.studio.guide"
        ariaLabel="Parts of a panel"
        items={items()}
        selected={null}
        onSelect={open}
        onActivate={open}
      >
        {(item, itemProps) => (
          <Row
            item={itemProps}
            density="compact"
            variant="stacked"
            leading={<Icon name={item.icon} />}
            onPress={() => open(item.key)}
          >
            <Stack gap="none">
              <Text>{item.label}</Text>
              <Text emphasis="muted" wrap>
                {item.help}
              </Text>
            </Stack>
          </Row>
        )}
      </Rows>
      <Text emphasis="muted" wrap>
        Or choose Ask AI and say what you want to change.
      </Text>
    </Stack>
  )
}

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
