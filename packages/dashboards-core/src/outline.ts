import type { DataBindingAddress, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { PanelPlan, PanelPlanColumn } from '@acorn/protocol/dashboards.ts'
import { PANEL_CAPABILITIES } from './capabilities'
import {
  AGGREGATE_LABELS, BUCKET_LABELS, CHART_SHAPE_LABELS, COLUMN_TYPE_LABELS, PRESENTATION_LABELS, SOURCE_ROLE_LABELS, TIME_MODE_LABELS, VIEW_LABELS,
  WEEK_START_LABELS, calendarLabel, offsetLabel, operatorLabel, sortDirectionLabel,
} from './labels'
import { outputPlanColumns, pointerColumn } from './planColumns'
import type { DashboardRun, PlanProblem, PlanSource, PlanStageCount } from './plan'

/** A plan as the named parts the studio selects, in plain words. The plan schema has no ids for
 *  steps or settings, so each part's key is derived here: a source and a column by their ids, a step
 *  by its index. The Node's describer reads the same wording helpers, so the two can't drift. */

export type PlanPartKey =
  | `source:${string}`
  | `input:${string}:${string}`
  | 'relations'
  | 'columns'
  | `column:${string}`
  | `stage:${number}`
  | 'arrange'
  | 'look'
  | 'behaviour'
  | 'settings'

export type PlanPart = {
  key: PlanPartKey
  section: 'data' | 'columns' | 'steps' | 'arrange' | 'look' | 'settings'
  title: string
  detail?: string
  /** A Lucide name, resolved client-side like other glyphs. */
  icon: string
  /** The JSON pointers this part owns, such as `/stages/0`. */
  paths: string[]
}

/** One derived-source input as the outline names it. The plan holds only the binding, so the client
 *  builds these from the source catalog and the person's accounts. */
export type PlanInput = { name: string; label: string; optional?: boolean; provider?: string; account?: string; reach?: string }
/** Each derived source's inputs, keyed by the plan source's id. */
export type PlanInputs = Readonly<Record<string, readonly PlanInput[]>>

/** The pointer to an input's binding in a plan source's inline query. */
export const inputBindingPath = (index: number, name: string): string => `/sources/${index}/reference/content/query/scope/inputs/${name}`

/** "Pull requests (GitHub · Work) and Cycle issues (Linear · Acme)", for About this panel. */
export const inputChain = (inputs: readonly PlanInput[]): string => {
  const named = inputs.map(input => {
    const where = [input.provider, input.account].filter(Boolean).join(' · ')
    return where ? `${input.label} (${where})` : input.label
  })
  return named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0] ?? ''
}

type Stage = PanelPlan['stages'][number]
type Relation = NonNullable<PanelPlan['relations']>[number]

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`
/** Joins the parts that exist with " · " and starts the result with a capital. */
const sentence = (...parts: (string | false | undefined)[]): string | undefined => {
  const text = parts.filter(Boolean).join(' · ')
  return text ? text[0]!.toUpperCase() + text.slice(1) : undefined
}

/** A column's label wherever the plan declares it: bound, calculated, or measured. Falls back to its id. */
export function columnLabel(plan: PanelPlan, id: string): string {
  return plan.columns.find(column => column.id === id)?.label
    ?? plan.stages.flatMap((stage): { id: string; label: string }[] => stage.op === 'compute' ? stage.columns : stage.op === 'summarize' ? stage.measures : []).find(column => column.id === id)?.label
    ?? id
}

function operandLabel(column: PanelPlanColumn | undefined, address: DataBindingAddress | undefined): string {
  if (address?.from === 'literal') {
    const word = (value: DataValue) => (typeof value === 'string' && column?.choices?.find(choice => choice.id === value)?.label) || JSON.stringify(value)
    return Array.isArray(address.value) ? address.value.map(word).join(', ') : word(address.value)
  }
  if (address?.from !== 'context') return 'another value'
  if (address.name === 'viewer') return 'you'
  if (address.name === 'workspaceLinks') return 'workspace links'
  if (address.name === 'now') return address.offset ? offsetLabel(address.offset) : 'now'
  return calendarLabel(address.boundary, address.offset)
}

/** "Author is you and Updated is after 7 days ago". */
export function describePredicate(plan: PanelPlan, predicate: DataPredicate): string {
  if (predicate.kind !== 'comparison') return predicate.predicates.map(part => describePredicate(plan, part)).join(predicate.kind === 'all' ? ' and ' : ' or ')
  const address = predicate.left.address
  const id = address.from === 'item' ? pointerColumn(address.pointer) : undefined
  const column = plan.columns.find(candidate => candidate.id === id)
  const compared = `${id ? columnLabel(plan, id) : 'a value'} ${operatorLabel(predicate.operator, column?.type)}`
  return predicate.operator === 'missing' || predicate.operator === 'present' ? compared : `${compared} ${operandLabel(column, predicate.right?.address)}`
}

/** What a source can see, from its declared reach: "Everything GitHub (Work) can see". */
export function sourceReach(source: PlanSource): string {
  const declared = source.description.reach
  if (!declared) return source.description.consistency
  const selected = readDataPointer(source.query.scope.parameters, declared.parameter)
  return Array.isArray(selected)
    ? selected.length ? `${selected.length} chosen ${declared.itemPlural}: ${selected.join(', ')}` : declared.empty
    : declared.default.replace('{account}', source.accountLabel ?? 'selected')
}

/** What pressing a row opens and where: "the pull request" in "a side panel". */
export function pressTarget(plan: PanelPlan, sources: readonly PlanSource[]): { subject: string; place: string } | undefined {
  const press = plan.actions?.press
  if (!press) return undefined
  const kinds = [...new Set(sources.filter(source => !press.source || source.instanceId === press.source).flatMap(source => source.description.targets?.map(target => target.kind) ?? []))]
  const subject = press.kind === 'link' ? plan.columns.find(column => column.id === press.column)?.label ?? 'a link'
    : press.kind === 'task' ? 'its task'
      : kinds.length === 1 ? `the ${kinds[0]!.split('.').at(-1)!.replaceAll('-', ' ')}` : 'the source record'
  return { subject, place: PRESENTATION_LABELS[press.prefer] }
}

const STAGE_ICONS: Record<Stage['op'], string> = { filter: 'list-filter', compute: 'calculator', summarize: 'sigma', expand: 'list-tree', overlap: 'calendar-range' }
/** The icon each view shows as, in the outline and the Look inspector. */
export const VIEW_ICONS: Record<PanelPlan['view']['kind'], string> = { stat: 'hash', list: 'list', table: 'table', board: 'kanban', chart: 'chart-column' }
const COLUMN_ICONS: Record<NonNullable<PanelPlanColumn['type']>, string> = {
  text: 'type', number: 'hash', boolean: 'toggle-left', datetime: 'calendar', enum: 'tag', person: 'user', link: 'link',
}

function stageWords(plan: PanelPlan, stage: Stage): { title: string; detail?: string } {
  const label = (id: string) => columnLabel(plan, id)
  switch (stage.op) {
    case 'filter': return { title: `Keep where ${describePredicate(plan, stage.where)}` }
    case 'compute': return { title: `Calculate ${stage.columns.map(column => column.label).join(', ')}` }
    case 'summarize': return {
      title: `One row per ${stage.by.map(by => `${label(by.column)}${by.bucket && by.bucket !== 'value' ? ` by ${BUCKET_LABELS[by.bucket].toLowerCase()}` : ''}`).join(' and ') || 'everything'}`,
      detail: stage.measures.map(measure => measure.label).join(', '),
    }
    case 'expand': return { title: `One row per item in ${label(stage.column)}` }
    case 'overlap': return { title: `One row per overlap of ${label(stage.start)} to ${label(stage.end)}`, ...(stage.partition ? { detail: `Within each ${label(stage.partition)}` } : {}) }
  }
}

const relationWords = (plan: PanelPlan, relation: Relation): string => {
  const to = plan.sources.find(source => source.id === relation.to)?.label ?? relation.to
  return relation.kind === 'equivalence' ? `Merge with ${to}` : relation.cardinality === 'one-to-many' ? `Attach ${to}` : `Look up ${to}`
}

const refreshWords = (seconds: number): string => seconds % 3600 === 0 ? plural(seconds / 3600, 'hour')
  : seconds % 60 === 0 ? plural(seconds / 60, 'minute') : plural(seconds, 'second')

/** The top-level parts, in outline order. Column parts come from `columnParts`. Pass `sources` after
 *  a run to name each source's account and reach; before one, a source is named by its own label.
 *  Pass `inputs` to list a derived source's inputs under it, one part each. */
export function planOutline(plan: PanelPlan, sources: readonly PlanSource[] = [], inputs: PlanInputs = {}): PlanPart[] {
  const finalColumn = (id: string) => outputPlanColumns(plan).find(column => column.id === id)
  const press = pressTarget(plan, sources)
  const buttons = plan.actions?.buttons.length ?? 0
  const { view } = plan
  return [
    ...plan.sources.flatMap((source, index): PlanPart[] => {
      const resolved = sources.find(candidate => candidate.instanceId === source.id)
      return [{
        key: `source:${source.id}`, section: 'data', icon: 'database', paths: [`/sources/${index}`],
        title: resolved?.accountLabel ? `${source.label} · ${resolved.accountLabel}` : source.label,
        detail: resolved ? sourceReach(resolved) : plan.sources.length > 1 ? SOURCE_ROLE_LABELS[source.role] : undefined,
      }, ...(inputs[source.id] ?? []).map((input): PlanPart => ({
        key: `input:${source.id}:${input.name}`, section: 'data', icon: 'plug', paths: [inputBindingPath(index, input.name)],
        title: input.optional ? `${input.label} (optional)` : input.label,
        detail: sentence(input.provider, input.account ?? (input.provider ? 'no account chosen' : undefined), input.reach),
      }))]
    }),
    ...(plan.sources.length > 1 || plan.relations?.length ? [{
      key: 'relations', section: 'data', icon: 'link-2', paths: ['/relations'],
      title: plan.relations?.length ? plan.relations.map(relation => relationWords(plan, relation)).join(', ') : 'No relations',
      detail: plural(plan.sources.length, 'source'),
    } satisfies PlanPart] : []),
    {
      key: 'columns', section: 'columns', icon: 'columns-3', paths: ['/columns'],
      title: plan.columns.map(column => column.label).join(', ') || 'No columns yet', detail: plural(plan.columns.length, 'column'),
    },
    ...plan.stages.map((stage, index): PlanPart => ({ key: `stage:${index}`, section: 'steps', icon: STAGE_ICONS[stage.op], paths: [`/stages/${index}`], ...stageWords(plan, stage) })),
    {
      key: 'arrange', section: 'arrange', icon: 'arrow-up-down', paths: ['/sort', '/group', '/limit'],
      title: sentence(plan.sort?.map(item => `${columnLabel(plan, item.column)}, ${sortDirectionLabel(item.direction, finalColumn(item.column)?.type)}`).join('; ')) ?? 'In source order',
      detail: sentence(!!plan.group?.length && `grouped by ${plan.group.map(item => columnLabel(plan, item.column)).join(' then ')}`, !!plan.limit && `at most ${plural(plan.limit, 'row')}`),
    },
    {
      key: 'look', section: 'look', icon: VIEW_ICONS[view.kind], paths: ['/view'], title: VIEW_LABELS[view.kind],
      detail: view.kind === 'chart' ? sentence(view.shape && CHART_SHAPE_LABELS[view.shape], view.x && `by ${columnLabel(plan, view.x)}`)
        : view.kind === 'stat' ? sentence(`${AGGREGATE_LABELS[view.aggregate ?? 'count']}${view.field ? ` of ${columnLabel(plan, view.field)}` : ''}`) : undefined,
    },
    {
      key: 'behaviour', section: 'look', icon: 'mouse-pointer-click', paths: ['/actions'],
      title: press ? `Click opens ${press.subject}` : 'Clicking a row does nothing',
      detail: sentence(press && `in ${press.place}`, buttons > 0 && plural(buttons, 'button')),
    },
    {
      key: 'settings', section: 'settings', icon: 'settings', paths: ['/title', '/time', '/refresh'],
      title: plan.refresh ? `Refresh every ${refreshWords(plan.refresh)}` : "Refresh on the source's schedule",
      detail: `${plan.time.mode === 'viewer' ? TIME_MODE_LABELS.viewer : plan.time.zone} · week starts ${WEEK_START_LABELS[plan.time.weekStart]}`,
    },
  ]
}

/** One part per bound column, for the columns inspector. */
export const columnParts = (plan: PanelPlan): PlanPart[] => plan.columns.map((column, index) => ({
  key: `column:${column.id}`, section: 'columns', title: column.label, paths: [`/columns/${index}`],
  icon: COLUMN_ICONS[column.type ?? 'text'],
  ...(column.type ? { detail: column.list ? `List of ${COLUMN_TYPE_LABELS[column.type].toLowerCase()}` : COLUMN_TYPE_LABELS[column.type] } : {}),
}))

/** The part owning the longest of its paths that prefixes `path`, so `/columns/3/bind/x` lands on the column. */
function ownerOf(parts: readonly PlanPart[], path: string): PlanPartKey | undefined {
  let owner: PlanPart | undefined
  let length = -1
  for (const part of parts) for (const owned of part.paths) {
    if ((path === owned || path.startsWith(`${owned}/`)) && owned.length > length) { owner = part; length = owned.length }
  }
  return owner?.key
}

const allParts = (plan: PanelPlan, inputs?: PlanInputs): PlanPart[] => [...planOutline(plan, [], inputs), ...columnParts(plan)]

/** The key of the part that owns a JSON pointer, or undefined for a path no part owns, such as `/sources`.
 *  An input's binding maps to its own part when `inputs` lists it, and to its source otherwise. */
export const partForPath = (plan: PanelPlan, path: string, inputs?: PlanInputs): PlanPartKey | undefined => ownerOf(allParts(plan, inputs), path)

/** Problems grouped by the part they belong to. A problem no part owns goes under `plan`, for the status bar. */
export function problemsByPart(plan: PanelPlan, problems: readonly PlanProblem[], inputs?: PlanInputs): Partial<Record<PlanPartKey | 'plan', PlanProblem[]>> {
  const parts = allParts(plan, inputs)
  const grouped: Partial<Record<PlanPartKey | 'plan', PlanProblem[]>> = {}
  for (const problem of problems) (grouped[ownerOf(parts, problem.path) ?? 'plan'] ??= []).push(problem)
  return grouped
}

/** Each step's row counts by its part key. With one source, the first step's input is the source's total.
 *  Pass the run's source diagnostics to count what each derived source read from each input. */
export function countsByPart(plan: PanelPlan, stages: readonly PlanStageCount[], sources: DashboardRun['diagnostics']['sources'] = []): {
  stages: Partial<Record<PlanPartKey, PlanStageCount>>; sourceTotal?: number; inputs: Partial<Record<PlanPartKey, number>>
} {
  const byPart = Object.fromEntries(stages.flatMap(count => {
    const index = /^\/stages\/(\d+)$/.exec(count.path)?.[1]
    return index === undefined ? [] : [[`stage:${index}`, count]]
  }))
  const inputs = Object.fromEntries(sources.flatMap(source => Object.entries(source.inputs ?? {}).map(([name, read]) => [`input:${source.id}:${name}`, read.records])))
  const first = stages.find(count => count.path === '/stages/0')
  return { stages: byPart, inputs, ...(plan.sources.length === 1 && first ? { sourceTotal: first.input } : {}) }
}

export type Availability<Id extends string> = { id: Id; label: string; description?: string; available: boolean; reason?: string }

/** Each step operation, and why it can't be added yet when it can't. */
export function availableOperations(plan: PanelPlan): Availability<Stage['op']>[] {
  const columns = outputPlanColumns(plan)
  const count = (op: Stage['op']) => plan.stages.filter(stage => stage.op === op).length
  const reason = (op: Stage['op']): string | undefined => !plan.columns.length ? 'Add a column first.'
    : plan.stages.length >= 8 ? 'A panel has at most eight steps.'
      : op === 'summarize' && count('summarize') >= 3 ? 'A panel has at most three summaries.'
        : op === 'overlap' && count('overlap') ? 'A panel has one overlap step.'
          : op === 'overlap' && columns.filter(column => column.type === 'datetime').length < 2 ? 'Needs two date columns.'
            : op === 'expand' && !columns.some(column => column.list) ? 'Needs a column that holds a list.'
              : undefined
  return PANEL_CAPABILITIES.operations.map(({ id, label, description }) => {
    const why = reason(id)
    return { id, label, description, available: !why, ...(why ? { reason: why } : {}) }
  })
}

type ViewNeed = (typeof PANEL_CAPABILITIES.views)[PanelPlan['view']['kind']]['needs'][number]

/** How a plan meets each `needs` entry a view declares. A new need fails `tsc` until it has a row here. */
const VIEW_NEEDS: Record<ViewNeed, { met: (plan: PanelPlan) => boolean; reason: string }> = {
  'enum group': {
    met: plan => plan.group?.length === 1 && outputPlanColumns(plan).find(column => column.id === plan.group![0]!.column)?.type === 'enum',
    reason: 'Group by a Choice column first.',
  },
  'date or enum axis': {
    met: plan => outputPlanColumns(plan).some(column => column.type === 'datetime' || column.type === 'enum'),
    reason: 'Needs a date or Choice column.',
  },
}

/** Each view, and why the plan can't use it yet when it can't. */
export function availableViews(plan: PanelPlan): Availability<PanelPlan['view']['kind']>[] {
  return (Object.keys(PANEL_CAPABILITIES.views) as PanelPlan['view']['kind'][]).map(id => {
    const unmet = (PANEL_CAPABILITIES.views[id].needs as readonly ViewNeed[]).find(need => !VIEW_NEEDS[need].met(plan))
    return { id, label: VIEW_LABELS[id], available: !unmet, ...(unmet ? { reason: VIEW_NEEDS[unmet].reason } : {}) }
  })
}

/** The plan shown as another view. Options the new view also has carry over, and the rest go. After a
 *  summary, a number or chart starts on its first measure, so it shows the summary rather than a count. */
export function switchView(plan: PanelPlan, kind: PanelPlan['view']['kind']): PanelPlan {
  const summary = [...plan.stages].reverse().find(stage => stage.op === 'summarize')
  const options: readonly string[] = PANEL_CAPABILITIES.views[kind].options
  const kept = Object.fromEntries(Object.entries(plan.view).filter(([key]) => options.includes(key)))
  return { ...plan, view: { ...kept, kind, ...(summary?.op === 'summarize' && (kind === 'stat' || kind === 'chart')
    ? { aggregate: 'sum' as const, ...(summary.measures[0] ? { field: summary.measures[0].id } : {}), ...(kind === 'chart' && summary.by[0] ? { x: summary.by[0].column } : {}) } : {}) } }
}

export type PartChange = 'added' | 'removed' | 'changed' | 'same'
export type OutlineDiff = {
  /** Every part key in either plan. Step keys are the after plan's; removed steps are in `removed`. */
  parts: Partial<Record<PlanPartKey, PartChange>>
  /** The before plan's steps that match nothing, keyed by their before index, for a struck-through row. */
  removed: PlanPart[]
  /** Column ids, for the columns row's detail: "+ Approval, − Draft". */
  columnChanges: { added: string[]; removed: string[]; changed: string[] }
}

/** JSON with object keys sorted, so two plans built in different key orders compare equal. */
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : 1)) : item)

/** Compares two plans part by part. Steps have no ids, so they match in two passes: identical steps
 *  wherever they sit, then the rest pairwise in order by operation. */
export function diffOutline(before: PanelPlan, after: PanelPlan): OutlineDiff {
  const isStage = (part: PlanPart) => part.key.startsWith('stage:')
  const signature = (plan: PanelPlan, part: PlanPart) => stableJson([part.title, part.detail, part.paths.map(path => readDataPointer(plan as unknown as DataValue, path))])
  const beforeParts = planOutline(before)
  const earlier = new Map(beforeParts.filter(part => !isStage(part)).map(part => [part.key, part]))
  const parts: OutlineDiff['parts'] = {}
  for (const part of planOutline(after).filter(part => !isStage(part))) {
    const old = earlier.get(part.key)
    parts[part.key] = !old ? 'added' : signature(before, old) === signature(after, part) ? 'same' : 'changed'
  }
  for (const key of earlier.keys()) parts[key] ??= 'removed'

  const unmatched = new Set(before.stages.keys())
  const claim = (test: (index: number) => boolean): boolean => {
    const index = [...unmatched].find(test)
    return index !== undefined && unmatched.delete(index)
  }
  const stages: PartChange[] = after.stages.map(stage => claim(index => stableJson(before.stages[index]) === stableJson(stage)) ? 'same' : 'added')
  after.stages.forEach((stage, index) => { if (stages[index] === 'added' && claim(at => before.stages[at]!.op === stage.op)) stages[index] = 'changed' })
  stages.forEach((change, index) => { parts[`stage:${index}`] = change })

  const columns = (plan: PanelPlan) => new Map(plan.columns.map(column => [column.id, stableJson(column)]))
  const was = columns(before), is = columns(after)
  return {
    parts,
    removed: beforeParts.filter(part => isStage(part) && unmatched.has(Number(part.key.slice('stage:'.length)))),
    columnChanges: {
      added: [...is.keys()].filter(id => !was.has(id)),
      removed: [...was.keys()].filter(id => !is.has(id)),
      changed: [...is.keys()].filter(id => was.has(id) && was.get(id) !== is.get(id)),
    },
  }
}
