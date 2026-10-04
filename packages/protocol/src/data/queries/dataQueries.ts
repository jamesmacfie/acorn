import { z } from 'zod'
import { queryTimeWindowSchema } from './dataQueryTime'
import { dataBindingSchema, type DataBinding } from '../values/dataBindings'
import { dataSourceQuerySchema, type DataSourceQuery } from '../dataSources'
import { parseDataSchema, type DataSchema } from '../values/dataSchemas'
import { parseDataValue, type DataValue } from '../values/dataValues'

const id = z.string().min(1).max(200)
export const queryScopeSchema = z.object({ workspaceId: id, projectId: id.optional() }).strict()
export const queryBindingsSchema = z.record(z.string().min(1).max(200), dataBindingSchema)
const parametersSchema = z.unknown().transform((input, ctx): DataSchema => {
  try {
    const schema = parseDataSchema(input)
    if (schema.type !== 'object' || schema.additionalProperties !== false) throw new Error()
    return schema
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Query parameters require a closed object schema' })
    return z.NEVER
  }
})
export const queryContentSchema = z.object({
  name: z.string().min(1).max(80),
  parameters: parametersSchema,
  query: dataSourceQuerySchema,
  sourceParameters: queryBindingsSchema.default({}),
  connection: dataBindingSchema.optional(),
  timeWindow: queryTimeWindowSchema.optional(),
}).strict()
export const queryReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline'), content: queryContentSchema, bindings: queryBindingsSchema.default({}) }).strict(),
  z.object({ kind: z.literal('saved'), queryId: id, revision: z.number().int().positive().optional(), bindings: queryBindingsSchema.default({}) }).strict(),
])
export const queryConsumerSchema = z.object({
  pluginId: id,
  kind: z.enum(['panel', 'workflow', 'schedule']),
  id,
  name: z.string().min(1).max(200),
  href: z.string().min(1).max(2048).refine(value => value.startsWith('/') && !value.startsWith('//')),
}).strict()
export type QueryScope = z.infer<typeof queryScopeSchema>
export type QueryContent = z.infer<typeof queryContentSchema>
export type QueryReference = z.infer<typeof queryReferenceSchema>
export type QueryConsumer = z.infer<typeof queryConsumerSchema>
export type QueryDraft = QueryScope & {
  id: string
  content: QueryContent
  draftRevision: number
  basePublishedRevision: number | null
  publishedRevision: number | null
  createdAt: number
  updatedAt: number
}
export type QueryRevision = QueryScope & {
  queryId: string
  revision: number
  content: QueryContent
  digest: string
  sourceRevision: string
  createdAt: number
}
export type ResolvedQuery = {
  query: DataSourceQuery
  parameters: Record<string, DataValue>
  published?: QueryRevision
}
export type QueryBindingContext = {
  evaluationTime?: number
  timePolicy?: { zone: string; weekStart: 'monday' | 'sunday' | 'saturday' }
  viewer?: import('../dataSources').DataSourceIdentity
  workspaceLinks?: string[]
  inputs?: Record<string, DataValue>
  steps?: Record<string, DataValue>
  item?: DataValue
}
export type QueryRecovery = {
  nodeId: string
  entityId: string
  baseRevision: number
  baseContent: QueryContent
  content: QueryContent
  savedAt: number
}
export type QuerySaveState = 'not-saved' | 'saved-on-device' | 'saving' | 'draft-saved' | 'conflict'
export type QueryBindings = Record<string, DataBinding>

const revision = z.number().int().positive()
const values = z.record(z.string(), z.unknown()).transform(value => parseDataValue(value) as Record<string, DataValue>)
export const queryLibraryRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), scope: queryScopeSchema }).strict(),
  z.object({ operation: z.literal('get'), scope: queryScopeSchema, id }).strict(),
  z.object({ operation: z.literal('create'), scope: queryScopeSchema, content: queryContentSchema }).strict(),
  z.object({ operation: z.literal('save'), scope: queryScopeSchema, id, expectedRevision: revision, content: queryContentSchema }).strict(),
  z.object({ operation: z.literal('publish'), scope: queryScopeSchema, id, expectedRevision: revision, validationParameters: values.default({}) }).strict(),
  z.object({ operation: z.literal('published'), scope: queryScopeSchema, id, revision: revision.optional() }).strict(),
  z.object({ operation: z.literal('delete'), scope: queryScopeSchema, id, expectedRevision: revision }).strict(),
  z.object({ operation: z.literal('consumers'), scope: queryScopeSchema, id }).strict(),
  z.object({ operation: z.literal('consumer'), scope: queryScopeSchema, id, consumer: queryConsumerSchema, remove: z.boolean().default(false) }).strict(),
  z.object({ operation: z.literal('resolve'), scope: queryScopeSchema, reference: queryReferenceSchema, inputs: values.default({}) }).strict(),
])
export type QueryLibraryRequest = z.infer<typeof queryLibraryRequestSchema>
