import { z } from 'zod'
import { queryReferenceSchema, queryScopeSchema, type QueryScope } from '../data/queries/dataQueries'
import { dataFieldsSchema, parseDataPredicate, type DataPredicate } from '../data/values/dataBindings'
import { DataValueError, parseDataSchema, validateDataValue, type DataSchema } from '../data/values/dataSchemas'
import { parseDataPointer, parseDataValue, type DataValue } from '../data/values/dataValues'
import { isPluginOpenableUrl } from '../content/externalUrl'
import { dashboardViewSchema } from './dashboardViews'

export { type DashboardView } from './dashboardViews'

const id = z.string().min(1).max(200)
const label = z.string().min(1).max(200)
const pointer = z.string().refine((value) => value === '' || value.startsWith('/'), 'Expected a JSON Pointer')

const dashboardMappingSchema = z
  .object({
    columns: z
      .array(
        z
          .object({
            id,
            label,
            tone: z.enum(['ok', 'warn', 'bad', 'muted', 'accent']).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    /** Query instance id -> panel role -> exact source field pointer. */
    fields: z
      .record(id, z.partialRecord(z.enum(['title', 'status', 'assignee', 'updated', 'url']), pointer))
      .default({}),
    /** Query instance id -> panel column id -> exact source status ids. */
    values: z.record(id, z.record(id, z.array(id).max(100))).default({}),
    unmapped: z.enum(['catch-all', 'hidden']).default('catch-all'),
  })
  .strict()

/** The panel field ids dashboards-core projects a mapped panel onto. */
const dashboardPanelFieldIds = ['title', 'status', 'assignee', 'updated', 'url', 'source'] as const

const dashboardPanelContentObject = z
  .object({
    title: label,
    queries: z
      .array(z.object({ id, label, reference: queryReferenceSchema }).strict())
      .min(1)
      .max(8),
    mapping: dashboardMappingSchema.default({ columns: [], fields: {}, values: {}, unmapped: 'catch-all' }),
    display: z
      .object({
        view: dashboardViewSchema,
        /** Panel field ids on a mapped panel, source pointers otherwise. See `dashboardDisplayRefFits`. */
        fields: z.array(z.string()).max(100).default([]),
        groupBy: z.string().optional(),
        limit: z.number().int().min(1).max(5000).optional(),
      })
      .strict(),
  })
  .strict()

type DashboardContentShape = z.infer<typeof dashboardPanelContentObject>

/** The same test `isMapped` in dashboards-core applies to the projected sources: a mapped panel's
 * schema is the panel field vocabulary, an unmapped one passes its source's fields through. */
const isMappedDashboard = (content: Pick<DashboardContentShape, 'queries' | 'mapping'>): boolean =>
  content.queries.length > 1 ||
  content.mapping.columns.length > 0 ||
  content.queries.some((query) => !!content.mapping.fields[query.id] || !!content.mapping.values[query.id])

/** `display.fields` and `display.groupBy` name a panel field on a mapped panel and a source pointer
 * otherwise, because those are the ids each projected schema carries. */
const dashboardDisplayRefFits = (mapped: boolean, ref: string): boolean =>
  mapped ? (dashboardPanelFieldIds as readonly string[]).includes(ref) : ref === '' || ref.startsWith('/')

/** Drops display references that the panel's mapping state can't resolve. A reference that no longer
 * fits shows nothing, so dropping it keeps the draft saveable without changing what it draws. */
function fitDashboardDisplay<T extends DashboardContentShape>(content: T): T {
  const mapped = isMappedDashboard(content)
  const fields = content.display.fields.filter((ref) => dashboardDisplayRefFits(mapped, ref))
  const { groupBy, ...display } = content.display
  const keepGroup = groupBy !== undefined && dashboardDisplayRefFits(mapped, groupBy)
  if (fields.length === content.display.fields.length && keepGroup === (groupBy !== undefined)) return content
  return { ...content, display: { ...display, fields, ...(keepGroup ? { groupBy } : {}) } }
}

function checkDashboardContent(content: DashboardContentShape, ctx: z.RefinementCtx): void {
  if (new Set(content.queries.map((query) => query.id)).size !== content.queries.length) {
    ctx.addIssue({ code: 'custom', path: ['queries'], message: 'Duplicate dashboard query instance' })
  }
  const mapped = isMappedDashboard(content)
  const expected = mapped ? `one of ${dashboardPanelFieldIds.join(', ')}` : 'a JSON Pointer'
  content.display.fields.forEach((ref, index) => {
    if (!dashboardDisplayRefFits(mapped, ref))
      ctx.addIssue({ code: 'custom', path: ['display', 'fields', index], message: `Expected ${expected}` })
  })
  if (content.display.groupBy !== undefined && !dashboardDisplayRefFits(mapped, content.display.groupBy)) {
    ctx.addIssue({ code: 'custom', path: ['display', 'groupBy'], message: `Expected ${expected}` })
  }
}

export const dashboardPanelContentSchema = dashboardPanelContentObject.superRefine(checkDashboardContent)

const dataValueSchema = z.unknown().transform((value, ctx): DataValue => {
  try {
    return parseDataValue(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid data value' })
    return z.NEVER
  }
})
const predicateSchema = z.unknown().transform((value, ctx): DataPredicate => {
  try {
    return parseDataPredicate(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid filter predicate' })
    return z.NEVER
  }
})
const columnId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)

/** Caps on one supplied source's rows. The rows live in the transcript, so they count toward its size. */
export const SUPPLIED_ROW_LIMITS = { rows: 1000, bytes: 256 * 1024 } as const
const suppliedRowSchema = z.unknown().transform((value, ctx): DataSchema => {
  try {
    const schema = parseDataSchema(value)
    if (schema.type === 'object') return schema
    ctx.addIssue({ code: 'custom', message: 'Supplied rows need an object schema' })
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: `Invalid row schema: ${(error as Error).message}` })
  }
  return z.NEVER
})
const schemaAt = (schema: DataSchema, pointer: string): DataSchema | undefined =>
  (parseDataPointer(pointer) ?? []).reduce<DataSchema | undefined>(
    (at, key) => (at?.properties && Object.hasOwn(at.properties, key) ? at.properties[key] : undefined),
    schema,
  )
/** Rows an agent gathered itself, carried in the plan in place of a registered source. `schema` and
 *  `fields` take a dataset's shapes, so the rows can be copied into a dataset unchanged. */
const suppliedRowsSchema = z
  .object({
    kind: z.literal('supplied'),
    origin: z
      .object({
        says: z.string().trim().min(1).max(200),
        urls: z.array(z.string().max(2048).refine(isPluginOpenableUrl, 'Expected an https URL')).max(8).optional(),
        readAt: z.number().finite(),
      })
      .strict(),
    schema: suppliedRowSchema,
    fields: dataFieldsSchema,
    rows: z.array(dataValueSchema).max(SUPPLIED_ROW_LIMITS.rows),
  })
  .strict()
  .superRefine((reference, ctx) => {
    for (const [index, field] of reference.fields.entries())
      if (!schemaAt(reference.schema, field.pointer))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'pointer'],
          message: `${field.pointer} isn't in the schema`,
        })
    let failures = 0
    for (const [index, row] of reference.rows.entries()) {
      try {
        validateDataValue(row, reference.schema)
      } catch (error) {
        const pointer = error instanceof DataValueError ? error.pointer : ''
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index, ...pointer.split('/').slice(1)],
          message: (error as Error).message,
        })
        // Enough to fix a pattern of mistakes without one issue per row.
        if (++failures === 10) return
      }
    }
    if (!failures && new TextEncoder().encode(JSON.stringify(reference.rows)).byteLength > SUPPLIED_ROW_LIMITS.bytes)
      ctx.addIssue({
        code: 'custom',
        path: ['rows'],
        message: `Supplied rows are over ${SUPPLIED_ROW_LIMITS.bytes / 1024} KiB`,
      })
  })
/** A plan source's reference: a registered source's query, or rows an agent supplied. Only a plan keeps
 *  supplied rows, so the query library and workflows never see them. */
const planSourceReferenceSchema = z.discriminatedUnion('kind', [...queryReferenceSchema.options, suppliedRowsSchema])
export type SuppliedRows = z.infer<typeof suppliedRowsSchema>
const presentation = z.enum(['route', 'refPanel', 'pane', 'overlay', 'external'])
const openReference = z
  .object({
    kind: z.enum(['record', 'task', 'link']),
    source: columnId.optional(),
    column: columnId.optional(),
    prefer: presentation,
  })
  .strict()
const rowButton = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open'), label, icon: id.optional(), reference: openReference }).strict(),
  z.object({ kind: z.literal('action'), label, icon: id.optional(), actionId: id }).strict(),
  z.object({ kind: z.literal('createTask'), label, icon: id.optional() }).strict(),
])
const panelPlanViewSchema = dashboardViewSchema
  .omit({ field: true, x: true, y: true, series: true })
  .extend({
    field: columnId.optional(),
    x: columnId.optional(),
    y: columnId.optional(),
    series: columnId.optional(),
  })
  .strict()
const choiceSchema = z
  .object({
    id,
    label,
    tone: z.enum(['ok', 'warn', 'bad', 'muted', 'accent']).optional(),
    rank: z.number().finite().optional(),
    /** Query instance ID to exact value sent to that source. Null is a valid target. */
    writeValues: z.record(columnId, dataValueSchema).optional(),
  })
  .strict()
const bindingSchema = z.union([
  z.object({ field: pointer, values: z.record(id, z.array(id).max(100)).optional() }).strict(),
  z.object({ value: dataValueSchema }).strict(),
])
export type PlanExpression =
  | { kind: 'column'; column: string }
  | { kind: 'literal'; value: DataValue }
  | { kind: 'clock'; name: 'now' }
  | {
      kind: 'arithmetic'
      operator: 'add' | 'subtract' | 'multiply' | 'divide'
      left: PlanExpression
      right: PlanExpression
    }
  | { kind: 'duration'; start: PlanExpression; end: PlanExpression; unit: 'ms' | 's' | 'minutes' | 'hours' | 'days' }
  | { kind: 'coalesce' | 'min' | 'max'; values: PlanExpression[] }
  | { kind: 'choice'; column: string; cases: Record<string, DataValue>; otherwise?: DataValue }
const expressionSchema: z.ZodType<PlanExpression> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('column'), column: columnId }).strict(),
    z.object({ kind: z.literal('literal'), value: dataValueSchema }).strict(),
    z.object({ kind: z.literal('clock'), name: z.literal('now') }).strict(),
    z
      .object({
        kind: z.literal('arithmetic'),
        operator: z.enum(['add', 'subtract', 'multiply', 'divide']),
        left: expressionSchema,
        right: expressionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('duration'),
        start: expressionSchema,
        end: expressionSchema,
        unit: z.enum(['ms', 's', 'minutes', 'hours', 'days']),
      })
      .strict(),
    z.object({ kind: z.enum(['coalesce', 'min', 'max']), values: z.array(expressionSchema).min(2).max(8) }).strict(),
    z
      .object({
        kind: z.literal('choice'),
        column: columnId,
        cases: z.record(id, dataValueSchema),
        otherwise: dataValueSchema.optional(),
      })
      .strict(),
  ]),
)
const relationSchema = z
  .object({
    id: columnId,
    from: columnId,
    to: columnId,
    kind: z.enum(['implements', 'blocks', 'belongs-to', 'references', 'equivalence']),
    cardinality: z.enum(['one-to-one', 'many-to-one', 'one-to-many']),
    keys: z
      .array(
        z
          .object({
            from: pointer,
            to: pointer,
            scope: z.enum(['provider', 'account', 'container', 'identity']).default('identity'),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    unmatched: z.enum(['keep', 'drop']).default('keep'),
    output: columnId.optional(),
    maxMatches: z.number().int().min(1).max(5000).default(5000),
  })
  .strict()
const measureSchema = z
  .object({
    id: columnId,
    label,
    kind: z.enum([
      'count',
      'count-where',
      'sum',
      'average',
      'minimum',
      'maximum',
      'median',
      'percentile',
      'distinct-count',
      'distinct-list',
      'earliest',
      'latest',
    ]),
    column: columnId.optional(),
    where: predicateSchema.optional(),
    percentile: z.number().int().min(1).max(99).optional(),
    share: z.boolean().optional(),
    previous: z.enum(['amount', 'ratio']).optional(),
  })
  .strict()
const stageSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('filter'), where: predicateSchema }).strict(),
  z
    .object({
      op: z.literal('compute'),
      columns: z
        .array(
          z
            .object({
              id: columnId,
              label,
              type: z.enum(['number', 'boolean', 'text', 'datetime']).optional(),
              unit: z.string().optional(),
              expression: expressionSchema,
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({
      op: z.literal('summarize'),
      by: z
        .array(
          z
            .object({
              column: columnId,
              bucket: z.enum(['value', 'day', 'week', 'month', 'hour', 'weekday']).optional(),
            })
            .strict(),
        )
        .max(3),
      measures: z.array(measureSchema).min(1).max(30),
      pivot: z.object({ column: columnId, measure: columnId }).strict().optional(),
      fill: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('expand'),
      column: columnId,
      output: columnId,
      perRow: z.number().int().min(1).max(100).default(100),
    })
    .strict(),
  z
    .object({
      op: z.literal('overlap'),
      start: columnId,
      end: columnId,
      partition: columnId.optional(),
      maxPairs: z.number().int().min(1).max(25000).default(5000),
    })
    .strict(),
])
export const panelPlanSchema = z
  .object({
    version: z.literal(2),
    title: label,
    request: z.string().max(8000).optional(),
    time: z
      .object({
        zone: z.string().min(1).max(100),
        mode: z.enum(['fixed', 'viewer']),
        weekStart: z.enum(['monday', 'sunday', 'saturday']),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            id: columnId,
            label,
            role: z.enum(['primary', 'lookup', 'children']),
            reference: planSourceReferenceSchema,
          })
          .strict(),
      )
      .min(1)
      .max(8),
    relations: z.array(relationSchema).max(8).optional(),
    columns: z
      .array(
        z
          .object({
            id: columnId,
            label,
            type: z.enum(['text', 'number', 'boolean', 'datetime', 'enum', 'person', 'link']).optional(),
            list: z.boolean().optional(),
            unit: z.union([z.string().min(1).max(16), z.object({ column: columnId }).strict()]).optional(),
            precision: z.enum(['instant', 'day']).optional(),
            choices: z.array(choiceSchema).max(100).optional(),
            unmatched: z.enum(['catch-all', 'hidden']).optional(),
            precedence: z.array(columnId).max(8).optional(),
            /** Left out of table and list views. Sort, group, filter, board, and chart can still use it. */
            hidden: z.boolean().optional(),
            bind: z.record(columnId, bindingSchema),
          })
          .strict(),
      )
      .max(100),
    stages: z.array(stageSchema).max(8),
    sort: z
      .array(
        z
          .object({ column: columnId, direction: z.enum(['asc', 'desc']), empty: z.enum(['first', 'last']).optional() })
          .strict(),
      )
      .max(8)
      .optional(),
    group: z
      .array(
        z
          .object({
            column: columnId,
            bucket: z.enum(['value', 'day', 'week', 'month', 'hour', 'weekday', 'relative']).optional(),
            order: z.enum(['declared', 'label', 'count', 'explicit']).optional(),
            values: z.array(z.string()).max(100).optional(),
          })
          .strict(),
      )
      .max(2)
      .optional(),
    limit: z.number().int().min(1).max(5000).optional(),
    view: panelPlanViewSchema,
    refresh: z.number().int().min(30).max(86400).optional(),
    actions: z
      .object({ press: openReference.optional(), buttons: z.array(rowButton).max(3).default([]) })
      .strict()
      .optional(),
    requirements: z
      .array(
        z
          .object({
            id: columnId,
            text: label,
            status: z.enum(['covered', 'partial', 'choice', 'unavailable']),
            reason: z.string().max(1000).optional(),
            paths: z.array(pointer).max(20).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
export type PanelPlan = z.infer<typeof panelPlanSchema>
export type PanelPlanColumn = PanelPlan['columns'][number]
const dashboardContentSchema = z.union([panelPlanSchema, dashboardPanelContentSchema])
export type DashboardContent = PanelPlan | DashboardPanelContent

/** A stored row may name a source pointer on a mapped panel. Reading it drops what can't resolve,
 * rather than failing the whole library list. */
export const storedDashboardPanelContentSchema = dashboardPanelContentObject
  .transform((content) => fitDashboardDisplay(content))
  .superRefine(checkDashboardContent)

export type DashboardMapping = z.infer<typeof dashboardMappingSchema>
export type DashboardPanelContent = z.infer<typeof dashboardPanelContentSchema>
export type DashboardScope = QueryScope
export type DashboardDraft = QueryScope & {
  id: string
  content: PanelPlan
  draftRevision: number
  basePublishedRevision: number | null
  publishedRevision: number | null
  createdAt: number
  updatedAt: number
}
export type DashboardRevision = QueryScope & {
  dashboardId: string
  revision: number
  content: PanelPlan
  digest: string
  createdAt: number
}
export type DashboardRecovery = {
  nodeId: string
  entityId: string
  baseRevision: number
  baseContent: DashboardContent
  content: DashboardContent
  savedAt: number
}

const revision = z.number().int().positive()
export const dashboardLibraryRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), scope: queryScopeSchema }).strict(),
  z.object({ operation: z.literal('get'), scope: queryScopeSchema, id }).strict(),
  z.object({ operation: z.literal('create'), scope: queryScopeSchema, content: panelPlanSchema }).strict(),
  z
    .object({
      operation: z.literal('save'),
      scope: queryScopeSchema,
      id,
      expectedRevision: revision,
      content: panelPlanSchema,
    })
    .strict(),
  z.object({ operation: z.literal('validate'), scope: queryScopeSchema, content: panelPlanSchema }).strict(),
  z.object({ operation: z.literal('publish'), scope: queryScopeSchema, id, expectedRevision: revision }).strict(),
  z.object({ operation: z.literal('published'), scope: queryScopeSchema, id, revision: revision.optional() }).strict(),
  z
    .object({
      operation: z.literal('run'),
      scope: queryScopeSchema,
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('published'), id, revision: revision.optional() }).strict(),
        z.object({ kind: z.literal('draft'), content: dashboardContentSchema }).strict(),
      ]),
      mode: z.enum(['preview', 'execution']),
      viewerZone: z.string().max(100).optional(),
      evaluationTime: z.number().finite().optional(),
      /** Values for the plan's `{ from: 'input' }` addresses, by input name, such as an app's picked task. */
      inputs: z.record(z.string().min(1).max(200), z.unknown()).optional(),
    })
    .strict(),
  z.object({ operation: z.literal('delete'), scope: queryScopeSchema, id, expectedRevision: revision }).strict(),
])

/** The `panel_show` agent tool's input, which the transcript's panel card reads back. The plan is only
 *  an object here: the tool checks it itself, so a bad plan comes back as problems with paths into it. */
export const panelShowInputSchema = z
  .object({ title: label, panelId: columnId.optional(), plan: z.record(z.string(), z.unknown()) })
  .strict()
export type PanelShowInput = z.infer<typeof panelShowInputSchema>
/** What `panel_show` returns. Never records: the card runs the plan itself, under the owner's device. */
export type PanelShowResult = { panelId: string; shownAt: number; description: string[] }
