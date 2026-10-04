import { describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { DATA_OPERATORS } from '@acorn/protocol/dataBindings.ts'
import {
  AGGREGATE_LABELS, ARITHMETIC_LABELS, BUCKET_LABELS, CHART_SHAPE_LABELS, COLUMN_TYPE_LABELS, COMPARE_LABELS, DURATION_UNIT_LABELS, EMPTY_SORT_LABELS, EXPRESSION_LABELS,
  GOOD_DIRECTION_LABELS, GROUP_ORDER_LABELS, MEASURE_LABELS, OPERATOR_LABELS, PRECISION_LABELS, PRESENTATION_LABELS, PREVIOUS_CHANGE_LABELS, RELATIVE_OFFSET_LABELS,
  SORT_DIRECTION_LABELS, SOURCE_ROLE_LABELS, TIME_MODE_LABELS, TONE_LABELS, TREND_LABELS, UNMATCHED_LABELS, VIEW_LABELS, WEEK_START_LABELS,
  calendarLabel, offsetLabel, operatorLabel, planPartLabel,
} from './labels'

// Read straight from the zod schemas, so a value added there fails here until it has a label. The
// walk uses zod's own `def.type` rather than importing zod, which this package doesn't depend on.
type Any = { def: { type: string }; unwrap(): Any; shape: Record<string, Any>; element: Any; options: unknown[]; values: Set<unknown> }
const unwrap = (schema: Any): Any => ['optional', 'default', 'lazy'].includes(schema.def.type) ? unwrap(schema.unwrap()) : schema
const field = (schema: Any, key: string): Any => unwrap(unwrap(schema).shape[key]!)
const element = (schema: Any): Any => unwrap(unwrap(schema).element)
const values = (schema: Any): string[] => {
  const inner = unwrap(schema)
  if (inner.def.type === 'enum') return inner.options.map(String)
  if (inner.def.type === 'literal') return [...inner.values].map(String)
  throw new Error(`Not an enum: ${inner.def.type}`)
}
const variants = (schema: Any): Any[] => unwrap(schema).options as Any[]
const variant = (schema: Any, key: string, value: string): Any => variants(schema).find(option => values(field(option, key)).includes(value))!

const plan = panelPlanSchema as unknown as Any
const column = element(field(plan, 'columns'))
const stages = element(field(plan, 'stages'))
const summarize = variant(stages, 'op', 'summarize')
const expression = field(element(field(variant(stages, 'op', 'compute'), 'columns')), 'expression')
const view = field(plan, 'view')

describe('panel labels', () => {
  it.each([
    ['source role', values(field(element(field(plan, 'sources')), 'role')), SOURCE_ROLE_LABELS],
    ['column type', values(field(column, 'type')), COLUMN_TYPE_LABELS],
    ['operator', [...DATA_OPERATORS], OPERATOR_LABELS],
    ['tone', values(field(element(field(column, 'choices')), 'tone')), TONE_LABELS],
    ['sort direction', values(field(element(field(plan, 'sort')), 'direction')), SORT_DIRECTION_LABELS],
    ['time mode', values(field(field(plan, 'time'), 'mode')), TIME_MODE_LABELS],
    ['week start', values(field(field(plan, 'time'), 'weekStart')), WEEK_START_LABELS],
    ['expression', variants(expression).flatMap(option => values(field(option, 'kind'))), EXPRESSION_LABELS],
    ['arithmetic', values(field(variant(expression, 'kind', 'arithmetic'), 'operator')), ARITHMETIC_LABELS],
    ['duration unit', values(field(variant(expression, 'kind', 'duration'), 'unit')), DURATION_UNIT_LABELS],
    ['measure', values(field(element(field(summarize, 'measures')), 'kind')), MEASURE_LABELS],
    ['group bucket', values(field(element(field(plan, 'group')), 'bucket')), BUCKET_LABELS],
    ['view', values(field(view, 'kind')), VIEW_LABELS],
    ['aggregate', values(field(view, 'aggregate')), AGGREGATE_LABELS],
    ['chart shape', values(field(view, 'shape')), CHART_SHAPE_LABELS],
    ['presentation', values(field(field(field(plan, 'actions'), 'press'), 'prefer')), PRESENTATION_LABELS],
    ['trend', values(field(view, 'trend')), TREND_LABELS],
    ['compare', values(field(view, 'compare')), COMPARE_LABELS],
    ['good direction', values(field(view, 'good')), GOOD_DIRECTION_LABELS],
    ['group order', values(field(element(field(plan, 'group')), 'order')), GROUP_ORDER_LABELS],
    ['empty sort', values(field(element(field(plan, 'sort')), 'empty')), EMPTY_SORT_LABELS],
    ['precision', values(field(column, 'precision')), PRECISION_LABELS],
    ['unmatched choice', values(field(column, 'unmatched')), UNMATCHED_LABELS],
    ['previous change', values(field(element(field(summarize, 'measures')), 'previous')), PREVIOUS_CHANGE_LABELS],
  ])('labels every %s', (_name, schemaValues, labels) => {
    expect(schemaValues.length).toBeGreaterThan(0)
    expect(Object.keys(labels).sort()).toEqual([...schemaValues].sort())
  })

  it('reads before and after on a date column', () => {
    expect(operatorLabel('lt', 'datetime')).toBe('is before')
    expect(operatorLabel('lte', 'datetime')).toBe('is at most')
    expect(operatorLabel('lt', 'number')).toBe('is less than')
  })

  it('reads every stored offset, and offers only offsets the schema accepts', () => {
    expect(offsetLabel('-P7D')).toBe('7 days ago')
    expect(offsetLabel('+P1W')).toBe('1 week from now')
    expect(calendarLabel('startOfMonth')).toBe('the start of this month')
    expect(calendarLabel('startOfWeek', '-P2W')).toBe('the start of the week 2 weeks ago')
    for (const [offset, label] of Object.entries(RELATIVE_OFFSET_LABELS)) expect(offsetLabel(offset)).toBe(label)
  })

  it('names the part a problem path points at', () => {
    const plan = { sources: [{ label: 'Workspace tasks' }], columns: [{ label: 'Status' }] } as never
    expect(planPartLabel(plan, '/sources/0')).toBe('Source Workspace tasks')
    expect(planPartLabel(plan, '/columns/0/bind/a')).toBe('Column Status')
    expect(planPartLabel(plan, '/stages/1')).toBe('Step 2')
    expect(planPartLabel(plan, '/time/zone')).toBe('Settings')
  })
})
