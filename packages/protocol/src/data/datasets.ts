import { z } from 'zod'
import { dataFieldsSchema, dataPointerSchema } from './values/dataBindings'
import { parseDataSchema } from './values/dataSchemas'
import { parseDataValue } from './values/dataValues'
import { dataSourceQuerySchema } from './dataSources'
import { panelPlanSchema } from '../dashboards/panels'

const id = z.string().min(1).max(200)
const structure = z.unknown().transform((value, ctx) => {
  try { return parseDataSchema(value) }
  catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid dataset schema' })
    return z.NEVER
  }
})
const data = z.unknown().transform((value, ctx) => {
  try { return parseDataValue(value) }
  catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid dataset row' })
    return z.NEVER
  }
})
export const datasetModeSchema = z.enum(['current-mirror', 'event-archive', 'snapshot-history'])
export const datasetFeederSchema = z.enum(['capture', 'workflow', 'agent'])
export const datasetCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  workspaceId: id,
  projectId: id.optional(),
  mode: datasetModeSchema,
  feeder: datasetFeederSchema,
  schema: structure,
  fields: dataFieldsSchema,
  identityFields: z.array(dataPointerSchema).min(1).max(8),
  eventTimeField: dataPointerSchema.optional(),
  backfillFrom: z.number().finite().optional(),
  captureQuery: dataSourceQuerySchema.optional(),
  retentionDays: z.number().int().min(1).max(3650).default(90),
  maxRows: z.number().int().min(1).max(2_000_000).default(500_000),
  maxBytes: z.number().int().min(1024).max(2_147_483_647).default(512 * 1024 * 1024),
}).strict().superRefine((value, ctx) => {
  if (value.schema.type !== 'object') ctx.addIssue({ code: 'custom', message: 'Dataset rows need an object schema.' })
  if (['_observationTime', '_arrivedAt'].some(name => value.schema.properties?.[name])) {
    ctx.addIssue({ code: 'custom', message: 'Dataset metadata field name is reserved.' })
  }
  if (value.mode === 'event-archive' && (!value.eventTimeField || value.backfillFrom === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Event archives need an event time and backfill boundary.' })
  }
  if (value.feeder === 'capture' && !value.captureQuery) ctx.addIssue({ code: 'custom', message: 'Capture query required.' })
  if (value.feeder !== 'capture' && value.captureQuery) ctx.addIssue({ code: 'custom', message: 'Only a capture feeder can have a query.' })
  if (value.feeder !== 'capture' && !value.projectId) ctx.addIssue({ code: 'custom', message: 'Task-fed datasets need a project.' })
  if (value.feeder === 'agent') {
    const properties = value.schema.properties ?? {}
    if (!properties.evidence || !properties.reason || !properties.correction
      || !Array.isArray(properties.correction.type) || !properties.correction.type.includes('null')) {
      ctx.addIssue({ code: 'custom', message: 'Agent datasets require evidence, reason, and nullable correction fields.' })
    }
  }
})
export const datasetVersionSchema = z.object({ datasetId: id, schema: structure, fields: dataFieldsSchema }).strict()
export const datasetWriteSchema = z.object({ datasetId: id, version: z.number().int().positive(), rows: z.array(z.object({
  data, evidence: data.optional(), reason: z.string().min(1).max(2048).optional(),
}).strict()).min(1).max(5000) }).strict()
export const datasetCorrectionSchema = z.object({ datasetId: id, identity: id, value: data }).strict()
export const datasetIdSchema = z.object({ datasetId: id }).strict()
export const datasetDrilldownSchema = z.object({
  scope: z.object({ workspaceId: id, projectId: id.optional() }).strict(),
  plan: panelPlanSchema, groupValues: z.record(z.string(), data), measureId: id.optional(),
  evaluationTime: z.number().finite(),
}).strict()

export type DatasetCreate = z.infer<typeof datasetCreateSchema>
export type DatasetWrite = z.infer<typeof datasetWriteSchema>
export type DatasetMode = z.infer<typeof datasetModeSchema>
export type DatasetFeeder = z.infer<typeof datasetFeederSchema>
export type DatasetSummary = {
  id: string; workspaceId: string; projectId: string | null; name: string; mode: DatasetMode; feeder: DatasetFeeder
  currentVersion: number; retentionDays: number; maxRows: number; maxBytes: number; rowCount: number; bytes: number
  coverage: { fromTime: number; toTime: number; kind: string; reason: string | null }[]
  lastCapture?: { finishedAt: number; complete: boolean; reason: string | null; rowCount: number }
}
