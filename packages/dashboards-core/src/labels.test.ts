import { describe, expect, it } from 'vitest'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { DATA_OPERATORS } from '@acorn/protocol/dataBindings.ts'
import {
  AGGREGATE_LABELS, ARITHMETIC_LABELS, BUCKET_LABELS, CHART_SHAPE_LABELS, COLUMN_TYPE_LABELS, DURATION_UNIT_LABELS, EXPRESSION_LABELS,
  MEASURE_LABELS, OPERATOR_LABELS, SORT_DIRECTION_LABELS, SOURCE_ROLE_LABELS, TIME_MODE_LABELS, TONE_LABELS, VIEW_LABELS, WEEK_START_LABELS,
  operatorLabel, planPartLabel,
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
  ])('labels every %s', (_name, schemaValues, labels) => {
    expect(schemaValues.length).toBeGreaterThan(0)
    expect(Object.keys(labels).sort()).toEqual([...schemaValues].sort())
  })

  it('reads before and after on a date column', () => {
    expect(operatorLabel('lt', 'datetime')).toBe('is before')
    expect(operatorLabel('lte', 'datetime')).toBe('is at most')
    expect(operatorLabel('lt', 'number')).toBe('is less than')
  })

  it('names the part a problem path points at', () => {
    const plan = { sources: [{ label: 'Workspace tasks' }], columns: [{ label: 'Status' }] } as never
    expect(planPartLabel(plan, '/sources/0')).toBe('Source Workspace tasks')
    expect(planPartLabel(plan, '/columns/0/bind/a')).toBe('Column Status')
    expect(planPartLabel(plan, '/stages/1')).toBe('Step 2')
    expect(planPartLabel(plan, '/time/zone')).toBe('Settings')
  })
})
