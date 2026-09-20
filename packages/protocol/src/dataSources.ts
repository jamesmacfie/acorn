import { z } from 'zod'
import { dataFieldsSchema, dataPointerSchema, parseDataPredicate, type DataPredicate } from './dataBindings'
import { parseDataSchema } from './dataSchemas'
import { DATA_LIMITS, parseDataValue } from './dataValues'
import { dataRecordActionSchema } from './dataActions'
import {
  dataSourceDescriptorSchema,
  dataSourceDiscoverySchema,
  dataSourceRegistrationSchema,
  type DataSourceDescriptor,
  type DataSourceDiscovery,
  type DataSourceRegistration,
} from './dataSourceContributions'

export {
  dataSourceDescriptorSchema,
  dataSourceDiscoverySchema,
  dataSourceRegistrationSchema,
  type DataSourceDescriptor,
  type DataSourceDiscovery,
  type DataSourceRegistration,
} from './dataSourceContributions'

export const DATA_SOURCE_PREVIEW_MODE = 'preview' as const

const id = z.string().min(1).max(200)
const cursor = z.string().min(1).max(4096)
const value = z.unknown().transform((input, ctx) => {
  try { return parseDataValue(input) }
  catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid data value' })
    return z.NEVER
  }
})
const structure = z.unknown().transform((input, ctx) => {
  try { return parseDataSchema(input) }
  catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid data schema' })
    return z.NEVER
  }
})
const predicate = z.unknown().transform((input, ctx): DataPredicate => {
  try { return parseDataPredicate(input) }
  catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid predicate' })
    return z.NEVER
  }
})
export const dataSourceRefSchema = z.object({ pluginId: id, sourceId: id }).strict()
export const dataSourceScopeSchema = z.object({
  workspaceId: id.optional(),
  projectId: id.optional(),
  connectionId: id.optional(),
  parameters: z.record(z.string(), value).default({}),
}).strict()
export const dataSourceDescriptionSchema = z.object({
  schema: structure,
  fields: dataFieldsSchema,
  parameters: structure,
  parameterFields: dataFieldsSchema.default([]),
  operations: z.object({
    query: z.literal(true),
    options: z.boolean(),
    details: z.boolean(),
    incremental: z.boolean(),
    groups: z.array(z.enum(['all', 'any'])).max(2),
  }).strict(),
  detailSchema: structure.optional(),
  incremental: z.object({
    semantics: z.string().min(1).max(2048),
  }).strict().optional(),
  revision: id,
  consistency: z.string().min(1).max(2048),
}).strict()
export const dataSourceQuerySchema = z.object({
  source: dataSourceRefSchema,
  scope: dataSourceScopeSchema,
  predicate: predicate.optional(),
  sort: z.array(z.object({
    pointer: dataPointerSchema,
    direction: z.enum(['asc', 'desc']),
  }).strict()).max(16).default([]),
  take: z.number().int().min(1).max(DATA_LIMITS.selectionRecords).optional(),
  incremental: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('baseline') }).strict(),
    z.object({ kind: z.literal('continue'), boundary: value }).strict(),
  ]).optional(),
}).strict().refine(query => !query.take || query.sort.length > 0, 'Take requires explicit stable ordering')
  .refine(query => !(query.take && query.incremental), 'Incremental queries cannot use take')
export const dataRecordRefSchema = dataSourceRefSchema.extend({ connectionId: id.optional(), recordId: id, scope: dataSourceScopeSchema.optional() })
export const dataSourceRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('describe'),
    source: dataSourceRefSchema,
    scope: dataSourceScopeSchema,
  }).strict(),
  z.object({
    operation: z.literal('options'),
    source: dataSourceRefSchema,
    scope: dataSourceScopeSchema,
    target: z.enum(['field', 'parameter']),
    pointer: dataPointerSchema,
    search: z.string().max(256).default(''),
    cursor: cursor.optional(),
    pageSize: z.number().int().min(1).max(DATA_LIMITS.options).default(DATA_LIMITS.options),
  }).strict(),
  z.object({
    operation: z.literal('query'),
    query: dataSourceQuerySchema,
    mode: z.enum([DATA_SOURCE_PREVIEW_MODE, 'execution']),
    evaluationTime: z.number().finite(),
    cursor: cursor.optional(),
    pageSize: z.number().int().min(1).max(DATA_LIMITS.options).default(DATA_LIMITS.previewRecords),
    timeoutMs: z.number().int().min(1).max(DATA_LIMITS.queryMs).optional(),
  }).strict(),
  z.object({
    operation: z.literal('details'),
    ref: dataRecordRefSchema,
    scope: dataSourceScopeSchema,
    projection: z.array(dataPointerSchema).max(DATA_LIMITS.fields).default([]),
  }).strict(),
])
export const dataSourceDiscoveryRequestSchema = z.object({
  pluginId: id,
  discoveryId: id,
  scope: dataSourceScopeSchema,
  cursor: cursor.optional(),
  pageSize: z.number().int().min(1).max(DATA_LIMITS.options).default(DATA_LIMITS.options),
}).strict()
export const dataSourceOptionsSchema = z.object({
  options: z.array(z.object({ id, label: z.string().min(1).max(80) }).strict()).max(DATA_LIMITS.options),
  nextCursor: cursor.optional(),
  exhausted: z.boolean(),
}).strict()
export const dataSourceDiscoveryPageSchema = z.object({
  sources: z.array(dataSourceDescriptorSchema).max(DATA_LIMITS.options),
  nextCursor: cursor.optional(),
  exhausted: z.boolean(),
}).strict()
export const dataSourceCatalogSchema = z.object({
  sources: z.array(dataSourceDescriptorSchema.extend({ pluginId: id })).max(DATA_LIMITS.fields),
  discoveries: z.array(dataSourceDiscoverySchema.omit({ handler: true }).extend({ pluginId: id })).max(DATA_LIMITS.fields),
}).strict()
export const dataSourceCompletenessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('more'), cursor }).strict(),
  z.object({ kind: z.literal('complete') }).strict(),
  z.object({ kind: z.literal('bounded') }).strict(),
  z.object({
    kind: z.literal('incomplete'),
    cause: z.enum(['upstream-cap', 'provider-failure', 'host-budget']),
  }).strict(),
])
export const dataSourcePageSchema = z.object({
  records: z.array(z.object({
    recordId: id,
    data: value,
    display: z.object({
      title: z.string().max(2048).optional(),
      url: z.string().url().max(2048).optional(),
    }).strict().optional(),
    taskId: z.string().uuid().optional(),
    action: dataRecordActionSchema.optional(),
  }).strict()).max(DATA_LIMITS.options),
  revision: id,
  readTime: z.number().finite(),
  completeness: dataSourceCompletenessSchema,
  incrementalBoundary: value.optional(),
}).strict()
export const dataSourceDetailsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('found'), data: z.unknown().transform(input => parseDataValue(input, DATA_LIMITS.detailBytes)), fetchedTime: z.number().finite(), schema: structure.optional() }).strict(),
  z.object({ kind: z.literal('not-found') }).strict(),
])
export type DataSourceRef = z.infer<typeof dataSourceRefSchema>
export type DataSourceScope = z.infer<typeof dataSourceScopeSchema>
export type DataSourceDescription = z.infer<typeof dataSourceDescriptionSchema>
export type DataSourceQuery = z.infer<typeof dataSourceQuerySchema>
export type DataSourceRequest = z.infer<typeof dataSourceRequestSchema>
export type DataRecordRef = z.infer<typeof dataRecordRefSchema>
export type DataRecord = Omit<z.infer<typeof dataSourcePageSchema>['records'][number], 'recordId'> & { ref: DataRecordRef }
export type DataSourcePage = z.infer<typeof dataSourcePageSchema>
export type DataSourceResult = Omit<DataSourcePage, 'records'> & { records: DataRecord[]; mode: 'preview' | 'execution'; evaluationTime: number }
export type DataSourceOptions = z.infer<typeof dataSourceOptionsSchema>
export type DataSourceDetails = z.infer<typeof dataSourceDetailsSchema>
export type DataSourceDiscoveryRequest = z.infer<typeof dataSourceDiscoveryRequestSchema>
export type DataSourceDiscoveryPage = Omit<z.infer<typeof dataSourceDiscoveryPageSchema>, 'sources'> & { sources: (DataSourceDescriptor & DataSourceRef)[] }
export type DataSourceCatalog = z.infer<typeof dataSourceCatalogSchema>
export type DataSourceResponse<R extends DataSourceRequest> = R extends { operation: 'describe' } ? DataSourceDescription
  : R extends { operation: 'options' } ? DataSourceOptions
    : R extends { operation: 'query' } ? DataSourceResult : DataSourceDetails
