import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { dashboardFields } from '@acorn/dashboards-core/projection'
import { newColumnId, outputPlanColumns } from '@acorn/dashboards-core/plan.ts'
import { defaultPlanColumns, fieldColumn, unbindMissingFields } from '../dashboardEditorModel'
import { newComparison, type Stage } from './stageFormParts'
import { blankPlan } from './studioStore'

// The studio's plan edits: each takes the plan, or one part of it, and returns the edited copy. The
// inspectors and the outline's Add menu call them inside `change`, so an edit reads the newest plan.

type Source = PanelPlan['sources'][number]
type Relation = NonNullable<PanelPlan['relations']>[number]
type DeclaredRelation = NonNullable<DataSourceDescription['relations']>[number]
type Column = PanelPlan['columns'][number]
type Choice = NonNullable<Column['choices']>[number]
type Sort = NonNullable<PanelPlan['sort']>[number]
type Group = NonNullable<PanelPlan['group']>[number]
type View = PanelPlan['view']
type Actions = NonNullable<PanelPlan['actions']>
type RowButton = Actions['buttons'][number]
type Press = NonNullable<Actions['press']>
type Field = ReturnType<typeof dashboardFields>[number]

/** Drops an optional key, because the plan schema is strict and refuses `undefined` values. */
export const without = <T extends object, K extends string>(
  value: T,
  key: K,
): T extends unknown ? Omit<T, K> : never => {
  const { [key]: _dropped, ...rest } = value as Record<string, unknown>
  return rest as T extends unknown ? Omit<T, K> : never
}
/** Swaps an item with its neighbour, `by` -1 for up and 1 for down. Unchanged at either end. */
export const swap = <T>(items: readonly T[], index: number, by: -1 | 1): T[] | undefined => {
  const target = index + by
  if (target < 0 || target >= items.length) return undefined
  const moved = [...items]
  ;[moved[index], moved[target]] = [moved[target]!, moved[index]!]
  return moved
}

// ── Sources ────────────────────────────────────────────────────────────────────────────────────

export const addSourceTo = (plan: PanelPlan, reference: QueryReference): PanelPlan => ({
  ...plan,
  sources: [
    ...plan.sources,
    { id: crypto.randomUUID(), label: `Source ${plan.sources.length + 1}`, role: 'primary', reference },
  ],
})
export const removeSourceFrom = (plan: PanelPlan, id: string): PanelPlan => ({
  ...plan,
  sources: plan.sources.filter((source) => source.id !== id),
  relations: plan.relations?.filter((relation) => relation.from !== id && relation.to !== id),
  columns: plan.columns.map((column) => ({ ...column, bind: without(column.bind, id) })),
})
const editSourceIn = (plan: PanelPlan, id: string, update: (source: Source) => Source): PanelPlan => ({
  ...plan,
  sources: plan.sources.map((entry) => (entry.id === id ? update(entry) : entry)),
})
/** The source reads `reference` now. With no reference, the source leaves the plan. */
export const setSourceReference = (plan: PanelPlan, id: string, reference: QueryReference | undefined): PanelPlan =>
  reference ? editSourceIn(plan, id, (entry) => ({ ...entry, reference })) : removeSourceFrom(plan, id)
export const setSourceRole = (plan: PanelPlan, id: string, role: Source['role']): PanelPlan =>
  editSourceIn(plan, id, (entry) => ({ ...entry, role }))
/** The plan once a source's picker describes what it reads. The source takes the picked source's
 *  `name`. When the person switched to another source, columns drop the fields it lacks. A panel's only
 *  source fills a panel with no columns yet, and names a panel still called "New panel". */
export function describeSourceIn(
  plan: PanelPlan,
  id: string,
  described: { name: string | undefined; switched: boolean; fields: Field[] },
): PanelPlan {
  const source = plan.sources.find((entry) => entry.id === id)
  if (!source) return plan
  const label = described.name ?? source.label
  const sources = plan.sources.map((entry) => (entry.id === id ? { ...entry, label } : entry))
  if (described.switched && plan.sources.length > 1)
    return { ...plan, sources, columns: unbindMissingFields(plan.columns, id, described.fields) }
  if (plan.sources.length !== 1 || (plan.columns.length && !described.switched))
    return JSON.stringify(sources) === JSON.stringify(plan.sources) ? plan : { ...plan, sources }
  return {
    ...plan,
    sources,
    columns: defaultPlanColumns(id, described.fields),
    ...(plan.title === blankPlan().title ? { title: label } : {}),
  }
}

// ── Relations ──────────────────────────────────────────────────────────────────────────────────

export const addRelationTo = (plan: PanelPlan, relation: Relation): PanelPlan => ({
  ...plan,
  relations: [...(plan.relations ?? []), relation],
})
/** Adds a relation the `from` source declares. A one-to-many relation also adds its list column,
 *  `output`, which the caller names from the relation's label. */
export const addDeclaredRelationTo = (
  plan: PanelPlan,
  relation: { from: string; to: string; declared: DeclaredRelation; output: string | undefined },
): PanelPlan => {
  const { from, to, declared, output } = relation
  const added = addRelationTo(plan, {
    id: declared.id,
    from,
    to,
    kind: declared.kind,
    cardinality: declared.cardinality,
    keys: declared.keys,
    unmatched: 'keep',
    maxMatches: 5000,
    ...(output ? { output } : {}),
  })
  if (!output) return added
  return {
    ...added,
    columns: [...added.columns, { id: output, label: declared.label, type: 'text', list: true, bind: {} }],
  }
}
export const setRelationUnmatched = (plan: PanelPlan, index: number, unmatched: Relation['unmatched']): PanelPlan => ({
  ...plan,
  relations: plan.relations?.map((entry, at) => (at === index ? { ...entry, unmatched } : entry)),
})
export const removeRelationFrom = (plan: PanelPlan, index: number): PanelPlan => ({
  ...plan,
  relations: plan.relations?.filter((_entry, at) => at !== index),
})

// ── Columns ────────────────────────────────────────────────────────────────────────────────────

export const NEW_COLUMN = 'New column'
export const addColumnTo = (plan: PanelPlan): PanelPlan => ({
  ...plan,
  columns: [...plan.columns, { id: newColumnId(plan, NEW_COLUMN), label: NEW_COLUMN, type: 'text', bind: {} }],
})
/** Adds a column that reads one source field, with an id from the field's name. */
export const addFieldColumnTo = (plan: PanelPlan, sourceId: string, field: Field): PanelPlan => ({
  ...plan,
  columns: [...plan.columns, fieldColumn(sourceId, field, newColumnId(plan, field.name))],
})
export const removeColumnFrom = (plan: PanelPlan, id: string): PanelPlan => ({
  ...plan,
  columns: plan.columns.filter((column) => column.id !== id),
})
export const moveColumnIn = (plan: PanelPlan, index: number, by: -1 | 1): PanelPlan => {
  const columns = swap(plan.columns, index, by)
  return columns ? { ...plan, columns } : plan
}
/** Drops the key when shown, so a column that was never hidden and one shown again save the same. */
export const setColumnHidden = (plan: PanelPlan, id: string, hidden: boolean): PanelPlan => ({
  ...plan,
  columns: plan.columns.map((column) => {
    if (column.id !== id) return column
    const { hidden: _was, ...shown } = column
    return hidden ? { ...shown, hidden: true } : shown
  }),
})
export const editColumnIn = (plan: PanelPlan, id: string, update: (column: Column) => Column): PanelPlan => ({
  ...plan,
  columns: plan.columns.map((entry) => (entry.id === id ? update(entry) : entry)),
})
/** The column as `type`. Settings for the old type don't apply to the new one, and the plan refuses some
 *  of them, so they go unless the type is unchanged. */
export function retypeColumn(column: Column, type: NonNullable<Column['type']>): Column {
  const rest = without(without(without(without(column, 'unit'), 'precision'), 'choices'), 'unmatched')
  if (type !== column.type) return { ...rest, type }
  return {
    ...rest,
    type,
    ...(column.unit ? { unit: column.unit } : {}),
    ...(column.precision ? { precision: column.precision } : {}),
    ...(column.choices ? { choices: column.choices } : {}),
    ...(column.unmatched ? { unmatched: column.unmatched } : {}),
  }
}
/** A number column's unit from the inspector's one choice: none (`''`), another column's value, a
 *  currency (USD until the person types a code), or a fixed unit. Another column means the first one in
 *  `columns` that isn't this column. */
export function setColumnUnit(column: Column, choice: string, columns: readonly Column[]): Column {
  const rest = without(column, 'unit')
  if (choice === '') return rest
  if (choice === 'column')
    return { ...rest, unit: { column: columns.find((other) => other.id !== column.id)?.id ?? '' } }
  return { ...rest, unit: choice === 'currency' ? 'USD' : choice }
}
/** Lists one source value under `choiceId`, or under no choice when `choiceId` is empty. */
export function mapSourceValue(column: Column, sourceId: string, valueId: string, choiceId: string): Column {
  const binding = column.bind[sourceId]
  if (!binding || !('field' in binding)) return column
  const values = Object.fromEntries(
    Object.entries(binding.values ?? {}).map(([id, ids]) => [id, ids.filter((value) => value !== valueId)]),
  )
  if (choiceId) values[choiceId] = [...(values[choiceId] ?? []), valueId]
  return { ...column, bind: { ...column.bind, [sourceId]: { ...binding, values } } }
}
export const editChoiceIn = (column: Column, index: number, update: (choice: Choice) => Choice): Column => ({
  ...column,
  choices: column.choices?.map((choice, at) => (at === index ? update(choice) : choice)),
})
export const addChoiceTo = (column: Column): Column => ({
  ...column,
  choices: [...(column.choices ?? []), { id: crypto.randomUUID(), label: 'New choice' }],
})
export const removeChoiceFrom = (column: Column, index: number): Column => ({
  ...column,
  choices: column.choices?.filter((_choice, at) => at !== index),
})
/** The choice's order from what the person typed. Anything but a number clears it. */
export function setChoiceRank(choice: Choice, typed: string): Choice {
  const rest = without(choice, 'rank')
  return typed.trim() && Number.isFinite(Number(typed)) ? { ...rest, rank: Number(typed) } : rest
}
/** The value a board drop writes to one source for this choice, or none when `present` is false. */
export function setChoiceWriteValue(
  choice: Choice,
  sourceId: string,
  value: DataValue | undefined,
  present: boolean,
): Choice {
  const writeValues = without(choice.writeValues ?? {}, sourceId)
  return { ...choice, writeValues: present ? { ...writeValues, [sourceId]: value! } : writeValues }
}

// ── Steps ──────────────────────────────────────────────────────────────────────────────────────

/** The plan with a new step for `op` at the end, or the plan unchanged when the step needs columns it
 *  lacks. Ids for the columns a step makes come from their labels. */
export const addStageTo = (plan: PanelPlan, op: Stage['op']): PanelPlan => {
  const columns = outputPlanColumns(plan)
  const dates = columns.filter((column) => column.type === 'datetime')
  const list = columns.find((column) => column.list)
  const stage: Stage | undefined =
    op === 'filter'
      ? { op, where: newComparison(columns[0]) }
      : op === 'compute'
        ? {
            op,
            columns: [
              {
                id: newColumnId(plan, 'Calculated value'),
                label: 'Calculated value',
                type: 'number',
                expression: {
                  kind: 'column',
                  column: columns.find((column) => column.type === 'number')?.id ?? columns[0]?.id ?? '',
                },
              },
            ],
          }
        : op === 'summarize'
          ? { op, by: [], measures: [{ id: newColumnId(plan, 'Count'), label: 'Count', kind: 'count' }] }
          : op === 'expand' && list
            ? { op, column: list.id, output: newColumnId(plan, `${list.label} item`), perRow: 100 }
            : op === 'overlap' && dates.length >= 2
              ? { op, start: dates[0]!.id, end: dates[1]!.id, maxPairs: 5000 }
              : undefined
  return stage ? { ...plan, stages: [...plan.stages, stage] } : plan
}
export const replaceStageIn = (plan: PanelPlan, index: number, stage: Stage): PanelPlan => ({
  ...plan,
  stages: plan.stages.map((entry, at) => (at === index ? stage : entry)),
})
export const removeStageFrom = (plan: PanelPlan, index: number): PanelPlan => ({
  ...plan,
  stages: plan.stages.filter((_stage, at) => at !== index),
})
export const moveStageIn = (plan: PanelPlan, index: number, by: -1 | 1): PanelPlan => {
  const stages = swap(plan.stages, index, by)
  return stages ? { ...plan, stages } : plan
}

// ── Arrange ────────────────────────────────────────────────────────────────────────────────────

export const editSortIn = (plan: PanelPlan, index: number, update: (sort: Sort) => Sort): PanelPlan => ({
  ...plan,
  sort: plan.sort?.map((entry, at) => (at === index ? update(entry) : entry)),
})
export const addSortTo = (plan: PanelPlan, column: string): PanelPlan => ({
  ...plan,
  sort: [...(plan.sort ?? []), { column, direction: 'desc' }],
})
export const removeSortFrom = (plan: PanelPlan, index: number): PanelPlan => ({
  ...plan,
  sort: plan.sort?.filter((_entry, at) => at !== index),
})
export const editGroupIn = (plan: PanelPlan, index: number, update: (group: Group) => Group): PanelPlan => ({
  ...plan,
  group: plan.group?.map((entry, at) => (at === index ? update(entry) : entry)),
})
export const addGroupTo = (plan: PanelPlan, column: string): PanelPlan => ({
  ...plan,
  group: [...(plan.group ?? []), { column }],
})
export const removeGroupFrom = (plan: PanelPlan, index: number): PanelPlan => ({
  ...plan,
  group: plan.group?.filter((_entry, at) => at !== index),
})
/** The grouping on another column. A custom order goes, and a time bucket stays only on a date column. */
export function regroupByColumn(group: Group, column: string, columnType: Column['type']): Group {
  const rest = without(without(group, 'bucket'), 'values')
  return { ...rest, column, ...(columnType === 'datetime' && group.bucket ? { bucket: group.bucket } : {}) }
}
export const setLimitIn = (plan: PanelPlan, limit: number | undefined): PanelPlan =>
  limit ? { ...plan, limit } : without(plan, 'limit')

// ── Look ───────────────────────────────────────────────────────────────────────────────────────

export const editViewIn = (plan: PanelPlan, update: (view: View) => View): PanelPlan => ({
  ...plan,
  view: update(plan.view),
})
/** A stat's number: a count of rows, or `aggregate` over a column. A calculation with no column yet
 *  reads `firstNumberColumn`. */
export function setStatAggregate(view: View, aggregate: string, firstNumberColumn: string | undefined): View {
  if (aggregate === 'count') return { ...without(view, 'field'), aggregate: 'count' }
  return {
    ...view,
    aggregate: aggregate as NonNullable<View['aggregate']>,
    ...(view.field ? {} : firstNumberColumn ? { field: firstNumberColumn } : {}),
  }
}

// ── Behaviour ──────────────────────────────────────────────────────────────────────────────────

/** What a row click does, from the inspector's choice: the source's default (`''`), the record, its
 *  task, or `link:<column>`. */
export function pressFromChoice(choice: string): Press | undefined {
  if (!choice) return undefined
  if (choice.startsWith('link:')) return { kind: 'link', column: choice.slice('link:'.length), prefer: 'refPanel' }
  return { kind: choice as 'record' | 'task', prefer: choice === 'task' ? 'pane' : 'refPanel' }
}
export const setPressIn = (plan: PanelPlan, press: Press | undefined): PanelPlan => ({
  ...plan,
  actions: { buttons: plan.actions?.buttons ?? [], ...(press ? { press } : {}) },
})
const editButtonsIn = (plan: PanelPlan, update: (buttons: RowButton[]) => RowButton[]): PanelPlan => ({
  ...plan,
  actions: { ...plan.actions, buttons: update(plan.actions?.buttons ?? []) },
})
export const editButtonIn = (plan: PanelPlan, index: number, update: (button: RowButton) => RowButton): PanelPlan =>
  editButtonsIn(plan, (buttons) => buttons.map((entry, at) => (at === index ? update(entry) : entry)))
export const addButtonTo = (plan: PanelPlan): PanelPlan =>
  editButtonsIn(plan, (buttons) => [
    ...buttons,
    { kind: 'open', label: 'Open', reference: { kind: 'record', prefer: 'refPanel' } },
  ])
export const removeButtonFrom = (plan: PanelPlan, index: number): PanelPlan =>
  editButtonsIn(plan, (buttons) => buttons.filter((_entry, at) => at !== index))
/** The button doing another job, from the inspector's choice: `open`, `createTask`, or
 *  `action:<id>`. The label and icon stay. */
export function setButtonJob(button: RowButton, choice: string): RowButton {
  const shared = { label: button.label, ...(button.icon ? { icon: button.icon } : {}) }
  if (choice === 'open') return { ...shared, kind: 'open', reference: { kind: 'record', prefer: 'refPanel' } }
  if (choice === 'createTask') return { ...shared, kind: 'createTask' }
  return { ...shared, kind: 'action', actionId: choice.slice('action:'.length) }
}
/** What an open button opens: the record, its task, or `link:<column>`. Where it opens stays. */
export function setButtonOpens(button: RowButton, target: string): RowButton {
  if (button.kind !== 'open') return button
  const prefer = button.reference.prefer
  return {
    ...button,
    reference: target.startsWith('link:')
      ? { kind: 'link', column: target.slice('link:'.length), prefer }
      : { kind: target as 'record' | 'task', prefer },
  }
}
export const setButtonPresentation = (button: RowButton, prefer: Press['prefer']): RowButton =>
  button.kind === 'open' ? { ...button, reference: { ...button.reference, prefer } } : button

// ── Settings ───────────────────────────────────────────────────────────────────────────────────

/** How often the panel reads its sources, in seconds from the picker. Empty means automatic. */
export const setRefreshIn = (plan: PanelPlan, seconds: string): PanelPlan =>
  seconds ? { ...plan, refresh: Number(seconds) } : without(plan, 'refresh')
export const editTimeIn = (plan: PanelPlan, time: Partial<PanelPlan['time']>): PanelPlan => ({
  ...plan,
  time: { ...plan.time, ...time },
})
