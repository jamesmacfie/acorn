import { z } from 'zod'
import { dataFieldsSchema, dataPointerSchema, parseDataPredicate, type DataPredicate } from './values/dataBindings'
import { parseDataSchema } from './values/dataSchemas'
import { DATA_LIMITS, parseDataValue } from './values/dataValues'
import { dataRecordActionSchema, dataRecordTargetSchema, namedDataRecordActionSchema } from './dataActions'
import {
  DATA_SOURCE_INPUT_NAME,
  dataSourceDescriptorSchema,
  dataSourceDiscoverySchema,
  dataSourceInputsSchema,
  type DataSourceDescriptor,
} from './dataSourceContributions'

export {
  dataSourceDescriptorSchema,
  dataSourceDiscoverySchema,
  dataSourceInputSchema,
  dataSourceInputsSchema,
  dataSourceRegistrationSchema,
  parseDataSourceInputRef,
  SOURCE_INPUTS_WITH_PROVIDER,
  type DataSourceDescriptor,
  type DataSourceDiscovery,
  type DataSourceInput,
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
const parameters = z.record(z.string(), value).default({})
const inputBindings = <T extends z.ZodType>(binding: T) => z.record(z.string().regex(DATA_SOURCE_INPUT_NAME), binding)
  .refine(inputs => Object.keys(inputs).length <= 8, 'At most eight input bindings')
/** One derived-source input's account and parameters, the same shape a direct call's scope uses. When
 *  the input is itself a derived source, `inputs` binds its inputs in turn: two derived levels at most. */
export const dataSourceInputBindingSchema = z.object({
  connectionId: id.optional(),
  parameters,
  inputs: inputBindings(z.object({ connectionId: id.optional(), parameters }).strict()).optional(),
}).strict()
export const dataSourceScopeSchema = z.object({
  workspaceId: id.optional(),
  projectId: id.optional(),
  connectionId: id.optional(),
  parameters,
  inputs: inputBindings(dataSourceInputBindingSchema).optional(),
}).strict()
export const dataSourceIdentitySchema = z.object({
  id: id.optional(), login: id.optional(), name: z.string().max(200).optional(),
  email: z.email().optional(), teamIds: z.array(id).max(200).optional(),
  teams: z.array(z.object({ id, name: z.string().max(200) }).strict()).max(200).optional(),
}).strict()
const coverageRangeSchema = z.object({ start: z.number().finite(), end: z.number().finite() }).strict()
export const dataSourceCoverageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot') }).strict(),
  z.object({ kind: z.literal('events'), retention: z.string().max(200).optional(), earliestTime: z.number().finite().optional(), complete: z.boolean() }).strict(),
])
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
    identity: z.boolean().optional(),
  }).strict(),
  detailSchema: structure.optional(),
  incremental: z.object({
    semantics: z.string().min(1).max(2048),
  }).strict().optional(),
  revision: id,
  consistency: z.string().min(1).max(2048),
  /** Host-owned dataset metadata; only core dataset sources set this. */
  dataset: z.object({ mode: z.enum(['current-mirror', 'event-archive', 'snapshot-history']),
    feeder: z.enum(['capture', 'workflow', 'agent']) }).strict().optional(),
  coverageWindows: z.array(z.object({ fromTime: z.number().finite(), toTime: z.number().finite(), kind: z.enum(['complete', 'gap']), reason: z.string().max(512).nullable() }).strict()).max(100).optional(),
  reach: z.object({ parameter: dataPointerSchema, itemPlural: z.string().min(1).max(80),
    default: z.string().min(1).max(300), empty: z.string().min(1).max(300) }).strict().optional(),
  /** Maps the record's external container to host-owned workspace projects. */
  projectScope: z.object({ kind: z.enum(['repository', 'external-project']),
    parameter: dataPointerSchema, record: dataPointerSchema }).strict().optional(),
  coverage: dataSourceCoverageSchema.optional(),
  /** Optional host-validated plan suggestions; a source never draws the resulting panel. */
  starterPlans: z.array(z.unknown()).max(10).optional(),
  /** Action and target metadata is structural; current eligibility is checked per record. */
  actions: z.array(z.object({ id, label: id, icon: id.optional(), risk: z.enum(['read', 'write', 'execute']) }).strict()).max(16).optional(),
  writable: z.array(z.object({ field: dataPointerSchema, path: z.string().min(1).max(256), risk: z.enum(['read', 'write', 'execute']),
    values: z.array(value).min(1).max(100) }).strict()).max(16).optional(),
  targets: z.array(dataRecordTargetSchema.pick({ kind: true })).max(16).optional(),
  /** Declarative relationship metadata. The host checks the scopes before matching rows. */
  relations: z.array(z.object({
    id, label: id, target: dataSourceRefSchema,
    kind: z.enum(['implements', 'blocks', 'belongs-to', 'references', 'equivalence']),
    cardinality: z.enum(['one-to-one', 'many-to-one', 'one-to-many']),
    keys: z.array(z.object({ from: dataPointerSchema, to: dataPointerSchema, scope: z.enum(['provider', 'account', 'container', 'identity']) }).strict()).min(1).max(8),
    requiredScopes: z.array(z.enum(['provider', 'account', 'container'])).min(2).max(3),
  }).strict()).max(16).optional(),
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
export const dataRecordRefSchema = dataSourceRefSchema.extend({ connectionId: id.optional(), recordId: id,
  projectId: id.optional(), scope: dataSourceScopeSchema.optional() })
export const dataSourceRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('identity'), source: dataSourceRefSchema, scope: dataSourceScopeSchema }).strict(),
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
  z.object({ operation: z.literal('actions'), ref: dataRecordRefSchema, scope: dataSourceScopeSchema }).strict(),
])
export const dataSourceActionsSchema = z.object({ actions: z.array(namedDataRecordActionSchema).max(16) }).strict()
export const dataSourceActSchema = z.union([
  z.object({ ref: dataRecordRefSchema, actionId: id, confirmedRisk: z.enum(['read', 'write', 'execute']), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ ref: dataRecordRefSchema, field: dataPointerSchema, expected: value, target: value,
    confirmedRisk: z.enum(['read', 'write', 'execute']), idempotencyKey: z.string().uuid() }).strict(),
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
  sources: z.array(dataSourceDescriptorSchema.extend({ pluginId: id, inputs: dataSourceInputsSchema.optional() })).max(DATA_LIMITS.fields),
  discoveries: z.array(dataSourceDiscoverySchema.omit({ handler: true }).extend({ pluginId: id })).max(DATA_LIMITS.fields),
}).strict()
export const dataSourceCompletenessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('more'), cursor }).strict(),
  z.object({ kind: z.literal('complete') }).strict(),
  z.object({ kind: z.literal('bounded') }).strict(),
  z.object({
    kind: z.literal('incomplete'),
    cause: z.enum(['upstream-cap', 'provider-failure', 'host-budget', 'coverage-gap', 'invalid-records']),
    /** With `invalid-records`: how many records a derived source returned that failed its schema. */
    count: z.number().int().min(1).optional(),
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
    actions: z.array(namedDataRecordActionSchema).max(16).optional(),
    writableFields: z.array(dataPointerSchema).max(16).optional(),
    target: dataRecordTargetSchema.optional(),
  }).strict()).max(DATA_LIMITS.options),
  revision: id,
  readTime: z.number().finite(),
  completeness: dataSourceCompletenessSchema,
  coveredRange: coverageRangeSchema.optional(),
  observedAt: z.number().finite().optional(),
  incrementalBoundary: value.optional(),
  /** Source-proved windows, independent of the time a capture happened. */
  eventCoverage: z.array(z.object({ fromTime: z.number().finite(), toTime: z.number().finite() }).strict()).max(32).optional(),
}).strict()
export const dataSourceDetailsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('found'), data: z.unknown().transform(input => parseDataValue(input, DATA_LIMITS.detailBytes)), fetchedTime: z.number().finite(), schema: structure.optional(), writableFields: z.array(dataPointerSchema).max(16).optional() }).strict(),
  z.object({ kind: z.literal('not-found') }).strict(),
])
export type DataSourceRef = z.infer<typeof dataSourceRefSchema>
export type DataSourceScope = z.infer<typeof dataSourceScopeSchema>
export type DataSourceInputBinding = z.infer<typeof dataSourceInputBindingSchema>
export type DataSourceDescription = z.infer<typeof dataSourceDescriptionSchema>
export type DataSourceIdentity = z.infer<typeof dataSourceIdentitySchema>
export type DataSourceQuery = z.infer<typeof dataSourceQuerySchema>
export type DataSourceRequest = z.infer<typeof dataSourceRequestSchema>
export type DataRecordRef = z.infer<typeof dataRecordRefSchema>
export type DataRecord = Omit<z.infer<typeof dataSourcePageSchema>['records'][number], 'recordId'> & { ref: DataRecordRef }
export type DataSourcePage = z.infer<typeof dataSourcePageSchema>
/** What one derived-source query read from each input: records across every page it asked for, and the
 *  last page's completeness. The host adds it; a plugin's own page never carries it. */
export type DataSourceInputRead = { records: number; completeness: DataSourcePage['completeness'] }
/** What a derived source's query cost, while its plugin is in development mode. Times are in
 *  milliseconds. `pluginMs` is the query's time less its input reads. `dropped` holds up to 20 of the
 *  records that failed the declared fields: the field's pointer and what was wrong. */
export type DataSourceDevelopment = {
  inputMs: Record<string, number>
  pluginMs: number
  dropped: { recordId: string; pointer: string; message: string }[]
}
export type DataSourceResult = Omit<DataSourcePage, 'records'> & { records: DataRecord[]; mode: 'preview' | 'execution'; evaluationTime: number
  /** Present on a derived source's query, keyed by input name, for each input the plugin queried. */
  inputs?: Record<string, DataSourceInputRead>
  /** Present on a derived source's query while its plugin is in development mode. */
  development?: DataSourceDevelopment }
export type DataSourceOptions = z.infer<typeof dataSourceOptionsSchema>
export type DataSourceDetails = z.infer<typeof dataSourceDetailsSchema>
export type DataSourceActions = z.infer<typeof dataSourceActionsSchema>
export type DataSourceDiscoveryRequest = z.infer<typeof dataSourceDiscoveryRequestSchema>
export type DataSourceDiscoveryPage = Omit<z.infer<typeof dataSourceDiscoveryPageSchema>, 'sources'> & { sources: (DataSourceDescriptor & DataSourceRef)[] }
export type DataSourceCatalog = z.infer<typeof dataSourceCatalogSchema>
export type DataSourceResponse<R extends DataSourceRequest> = R extends { operation: 'describe' } ? DataSourceDescription
  : R extends { operation: 'identity' } ? DataSourceIdentity
  : R extends { operation: 'options' } ? DataSourceOptions
    : R extends { operation: 'query' } ? DataSourceResult : R extends { operation: 'actions' } ? DataSourceActions : DataSourceDetails
