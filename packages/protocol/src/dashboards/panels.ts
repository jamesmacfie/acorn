import { z } from 'zod'
import { queryReferenceSchema, queryScopeSchema, type QueryReference, type QueryScope } from '../data/queries/dataQueries'
import { dashboardViewSchema } from './dashboardViews'

export { dashboardViewKinds, dashboardViewSchema, type DashboardView } from './dashboardViews'

const id = z.string().min(1).max(200)
const label = z.string().min(1).max(200)
const pointer = z.string().refine(value => value === '' || value.startsWith('/'), 'Expected a JSON Pointer')

export const dashboardMappingSchema = z.object({
  columns: z.array(z.object({
    id,
    label,
    tone: z.enum(['ok', 'warn', 'bad', 'muted', 'accent']).optional(),
  }).strict()).max(100).default([]),
  /** Query instance id -> panel role -> exact source field pointer. */
  fields: z.record(id, z.partialRecord(z.enum(['title', 'status', 'assignee', 'updated', 'url']), pointer)).default({}),
  /** Query instance id -> panel column id -> exact source status ids. */
  values: z.record(id, z.record(id, z.array(id).max(100))).default({}),
  unmapped: z.enum(['catch-all', 'hidden']).default('catch-all'),
}).strict()

export const dashboardPanelContentSchema = z.object({
  title: label,
  queries: z.array(z.object({ id, label, reference: queryReferenceSchema }).strict()).min(1).max(8),
  mapping: dashboardMappingSchema.default({ columns: [], fields: {}, values: {}, unmapped: 'catch-all' }),
  display: z.object({
    view: dashboardViewSchema,
    fields: z.array(pointer).max(100).default([]),
    groupBy: pointer.optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  }).strict(),
}).strict().refine(content => new Set(content.queries.map(query => query.id)).size === content.queries.length, 'Duplicate dashboard query instance')

export type DashboardMapping = z.infer<typeof dashboardMappingSchema>
export type DashboardPanelContent = z.infer<typeof dashboardPanelContentSchema>
export type DashboardPanelQuery = { id: string; label: string; reference: QueryReference }
export type DashboardScope = QueryScope
export type DashboardDraft = QueryScope & {
  id: string
  content: DashboardPanelContent
  draftRevision: number
  basePublishedRevision: number | null
  publishedRevision: number | null
  createdAt: number
  updatedAt: number
}
export type DashboardRevision = QueryScope & {
  dashboardId: string
  revision: number
  content: DashboardPanelContent
  digest: string
  createdAt: number
}
export type DashboardRecovery = {
  nodeId: string
  entityId: string
  baseRevision: number
  baseContent: DashboardPanelContent
  content: DashboardPanelContent
  savedAt: number
}

const revision = z.number().int().positive()
export const dashboardLibraryRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), scope: queryScopeSchema }).strict(),
  z.object({ operation: z.literal('get'), scope: queryScopeSchema, id }).strict(),
  z.object({ operation: z.literal('create'), scope: queryScopeSchema, content: dashboardPanelContentSchema }).strict(),
  z.object({ operation: z.literal('save'), scope: queryScopeSchema, id, expectedRevision: revision, content: dashboardPanelContentSchema }).strict(),
  z.object({ operation: z.literal('validate'), scope: queryScopeSchema, content: dashboardPanelContentSchema }).strict(),
  z.object({ operation: z.literal('publish'), scope: queryScopeSchema, id, expectedRevision: revision }).strict(),
  z.object({ operation: z.literal('published'), scope: queryScopeSchema, id, revision: revision.optional() }).strict(),
  z.object({ operation: z.literal('delete'), scope: queryScopeSchema, id, expectedRevision: revision }).strict(),
])
export type DashboardLibraryRequest = z.infer<typeof dashboardLibraryRequestSchema>
