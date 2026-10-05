import type { PanelPlan, PlanExpression } from '@acorn/protocol/dashboards.ts'
import type { DataOperator } from '@acorn/protocol/dataBindings.ts'
import { PANEL_CAPABILITIES } from './capabilities'

/** The one place a panel plan's schema values become words. Stored values never change; only what a
 *  person reads does. Each map is typed against its schema enum, and labels.test.ts reads the zod
 *  schemas, so a new schema value fails until it has a label here. */

type Column = PanelPlan['columns'][number]
type Stage = PanelPlan['stages'][number]
type Measure = Extract<Stage, { op: 'summarize' }>['measures'][number]

export const SOURCE_ROLE_LABELS: Record<PanelPlan['sources'][number]['role'], string> = {
  primary: 'Adds rows', lookup: 'Adds columns to each row', children: 'Adds a list to each row',
}

export const COLUMN_TYPE_LABELS: Record<NonNullable<Column['type']>, string> = {
  text: 'Text', number: 'Number', boolean: 'Yes or no', datetime: 'Date and time', enum: 'Choice', person: 'Person', link: 'Link',
}

export const OPERATOR_LABELS: Record<DataOperator, string> = {
  eq: 'is', ne: 'is not', lt: 'is less than', lte: 'is at most', gt: 'is more than', gte: 'is at least',
  contains: 'contains', in: 'is one of', missing: 'is empty', present: 'has a value',
}

/** A comparison's words, which read differently on a date column. */
export const operatorLabel = (operator: DataOperator, type?: Column['type']): string => type === 'datetime'
  ? { lt: 'is before', gt: 'is after' }[operator as 'lt' | 'gt'] ?? OPERATOR_LABELS[operator]
  : OPERATOR_LABELS[operator]

export const TONE_LABELS: Record<NonNullable<NonNullable<Column['choices']>[number]['tone']>, string> = {
  ok: 'Green', warn: 'Amber', bad: 'Red', muted: 'Grey', accent: 'Accent',
}

export const SORT_DIRECTION_LABELS: Record<NonNullable<PanelPlan['sort']>[number]['direction'], string> = {
  asc: 'Lowest or oldest first', desc: 'Highest or newest first',
}

export const REQUIREMENT_STATUS_LABELS: Record<NonNullable<PanelPlan['requirements']>[number]['status'], string> = {
  covered: 'Covered', partial: 'Partly covered', choice: 'Needs a choice', unavailable: 'Unavailable',
}

export const TIME_MODE_LABELS: Record<PanelPlan['time']['mode'], string> = {
  fixed: 'Always this time zone', viewer: "Each viewer's time zone",
}

export const WEEK_START_LABELS: Record<PanelPlan['time']['weekStart'], string> = {
  monday: 'Monday', sunday: 'Sunday', saturday: 'Saturday',
}

export const EXPRESSION_LABELS: Record<PlanExpression['kind'], string> = {
  column: 'A column', literal: 'A fixed value', clock: 'The current time', arithmetic: 'Arithmetic', duration: 'Time between',
  coalesce: 'First value that exists', choice: 'By choice', min: 'Smallest of', max: 'Largest of',
}

export const ARITHMETIC_LABELS: Record<Extract<PlanExpression, { kind: 'arithmetic' }>['operator'], string> = {
  add: 'Plus', subtract: 'Minus', multiply: 'Times', divide: 'Divided by',
}

export const DURATION_UNIT_LABELS: Record<Extract<PlanExpression, { kind: 'duration' }>['unit'], string> = {
  ms: 'Milliseconds', s: 'Seconds', minutes: 'Minutes', hours: 'Hours', days: 'Days',
}

export const MEASURE_LABELS: Record<Measure['kind'], string> = {
  count: 'Count', 'count-where': 'Count matching', sum: 'Total', average: 'Average', minimum: 'Smallest', maximum: 'Largest',
  median: 'Median', percentile: 'Percentile', 'distinct-count': 'Count of different values', 'distinct-list': 'List of different values',
  earliest: 'Earliest', latest: 'Latest',
}

export const BUCKET_LABELS: Record<NonNullable<NonNullable<PanelPlan['group']>[number]['bucket']>, string> = {
  value: 'Each value', day: 'Day', week: 'Week', month: 'Month', relative: 'How long ago',
}

export const VIEW_LABELS: Record<PanelPlan['view']['kind'], string> = {
  stat: 'Number', list: 'List', table: 'Table', board: 'Board', chart: 'Chart',
}

/** What each view is good for, under its name where a person picks one. */
export const VIEW_HELP: Record<PanelPlan['view']['kind'], string> = {
  stat: 'One big number, such as a count or a total.',
  list: 'Each row as a title with a few details under it.',
  table: 'Every column side by side, one row per line.',
  board: 'Cards in columns, one column per choice.',
  chart: 'Bars or a line across dates or choices.',
}

/** What each step does, in the Add menu and at the top of its form. The capability list's own
 *  descriptions are written for the AI author, so they aren't shown to people. */
export const OPERATION_HELP: Record<Stage['op'], string> = {
  filter: 'Keeps only the rows that match your conditions.',
  compute: 'Adds a column worked out from other columns, such as a difference or a count of days.',
  summarize: 'Turns many rows into one row per group, with counts or totals.',
  expand: 'Turns each item in a list column into a row of its own.',
  overlap: 'Makes one row for each pair of rows whose dates overlap.',
}

export const AGGREGATE_LABELS: Record<NonNullable<PanelPlan['view']['aggregate']>, string> = {
  count: 'Count', sum: 'Total', avg: 'Average', min: 'Smallest', max: 'Largest',
}

export const CHART_SHAPE_LABELS: Record<NonNullable<PanelPlan['view']['shape']>, string> = { bar: 'Bars', line: 'Line' }

export const TREND_LABELS: Record<NonNullable<PanelPlan['view']['trend']>, string> = { history: 'Saved history', activity: 'Recent activity' }

export const COMPARE_LABELS: Record<NonNullable<PanelPlan['view']['compare']>, string> = { day: 'Yesterday', week: 'Last week' }

export const GOOD_DIRECTION_LABELS: Record<NonNullable<PanelPlan['view']['good']>, string> = { up: 'Up', down: 'Down' }

export const GROUP_ORDER_LABELS: Record<NonNullable<NonNullable<PanelPlan['group']>[number]['order']>, string> = {
  declared: "The column's order", label: 'Name', count: 'Size', explicit: 'A custom order',
}

export const EMPTY_SORT_LABELS: Record<NonNullable<NonNullable<PanelPlan['sort']>[number]['empty']>, string> = { first: 'First', last: 'Last' }

export const PRECISION_LABELS: Record<NonNullable<Column['precision']>, string> = { instant: 'A date and time', day: 'A calendar day' }

export const UNMATCHED_LABELS: Record<NonNullable<Column['unmatched']>, string> = { 'catch-all': 'Show them under Other', hidden: 'Hide them' }

export const PREVIOUS_CHANGE_LABELS: Record<NonNullable<Measure['previous']>, string> = { amount: 'As an amount', ratio: 'As a percentage' }

/** The fixed units a number column offers. Any other unit is a three-letter currency code. */
export const UNIT_LABELS: Record<string, string> = { percent: 'Percent', ms: 'Milliseconds', s: 'Seconds', bytes: 'Bytes' }

/** Relative date offsets a filter offers, as the signed ISO 8601 durations the schema stores. */
export const RELATIVE_OFFSET_LABELS: Record<string, string> = {
  '-P1D': '1 day ago', '-P7D': '7 days ago', '-P14D': '14 days ago', '-P30D': '30 days ago', '-P90D': '90 days ago',
  '+P1D': '1 day from now', '+P7D': '7 days from now',
}

/** "7 days ago" or "1 week from now" for any offset a filter stores, not only the ones it offers. */
export function offsetLabel(offset: string): string {
  const match = /^([+-])P(\d+)([DWM])$/.exec(offset)
  if (!match) return offset
  const [, sign, count, unit] = match
  const amount = `${count} ${{ D: 'day', W: 'week', M: 'month' }[unit!]}${count === '1' ? '' : 's'}`
  return sign === '-' ? `${amount} ago` : `${amount} from now`
}

const CALENDAR_UNITS = { startOfDay: 'day', startOfWeek: 'week', startOfMonth: 'month' } as const

/** "the start of this week", or "the start of the week 1 week ago" with an offset. */
export const calendarLabel = (boundary: keyof typeof CALENDAR_UNITS, offset?: string): string => offset
  ? `the start of the ${CALENDAR_UNITS[boundary]} ${offsetLabel(offset)}`
  : `the start of this ${CALENDAR_UNITS[boundary]}`

type Press = NonNullable<NonNullable<PanelPlan['actions']>['press']>

/** Where an opened row lands, read as "opens it in …". */
export const PRESENTATION_LABELS: Record<Press['prefer'], string> = {
  route: 'a full page', refPanel: 'a side panel', pane: 'a task pane', overlay: 'an overlay', external: 'the browser',
}

/** A sort direction's words, which read differently on a date or a number column. */
export const sortDirectionLabel = (direction: NonNullable<PanelPlan['sort']>[number]['direction'], type?: Column['type']): string =>
  type === 'datetime' ? direction === 'desc' ? 'newest first' : 'oldest first'
    : type === 'number' ? direction === 'desc' ? 'highest first' : 'lowest first'
      : SORT_DIRECTION_LABELS[direction].toLowerCase()

/** A label map as `Select` options, in the map's order. */
export const labelOptions = (labels: Record<string, string>): { value: string; label: string }[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))

/** The name of the plan part a problem path points at: "Source Workspace tasks", "Column Status",
 *  "Step 2". Phase 2's outline names parts the same way. */
export function planPartLabel(plan: PanelPlan, path: string): string {
  const [part, index] = path.split('/').slice(1)
  const at = Number(index)
  if (part === 'sources') return plan.sources[at] ? `Source ${plan.sources[at].label}` : 'Sources'
  if (part === 'columns') return plan.columns[at] ? `Column ${plan.columns[at].label}` : 'Columns'
  if (part === 'stages') return Number.isInteger(at) ? `Step ${at + 1}` : 'Steps'
  if (part === 'relations') return 'Relations'
  if (part === 'sort' || part === 'group' || part === 'limit') return 'Arrange'
  if (part === 'view') return 'Look'
  if (part === 'actions') return 'Row actions'
  if (part === 'title') return 'Title'
  return 'Settings'
}

/** "Keep matching rows" for a step's operation. */
export const operationLabel = (op: Stage['op']): string => PANEL_CAPABILITIES.operations.find(operation => operation.id === op)?.label ?? op
