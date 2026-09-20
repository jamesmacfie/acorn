import { z } from 'zod'
import { parseDataPointer } from './dataValues'

// Keep the manifest carrier independent of the invocation contract. Every client parses installed
// plugin manifests during startup, while query schemas and value validation belong to the lazy data
// authoring/runtime paths. Pulling the complete source protocol through plugin/contract made those
// execution-only schemas part of both clients' first-frame graph.
const id = z.string().min(1).max(200)
const pointer = z.string().refine(value => parseDataPointer(value) !== null, 'Invalid data pointer')

export const dataSourceDescriptorSchema = z.object({
  sourceId: id,
  name: z.string().min(1).max(80),
  singular: z.string().min(1).max(80),
  plural: z.string().min(1).max(80),
  identityScope: z.string().min(1).max(2048),
  icon: z.string().max(80).optional(),
  providerId: id.optional(),
  titlePointer: pointer.optional(),
  urlPointer: pointer.optional(),
}).strict()

export const dataSourceRegistrationSchema = dataSourceDescriptorSchema.extend({
  handler: z.string().min(1).max(2048),
})

export const dataSourceDiscoverySchema = z.object({
  discoveryId: id,
  handler: z.string().min(1).max(2048),
  providerId: id.optional(),
}).strict()

export type DataSourceDescriptor = z.infer<typeof dataSourceDescriptorSchema>
export type DataSourceRegistration = z.infer<typeof dataSourceRegistrationSchema>
export type DataSourceDiscovery = z.infer<typeof dataSourceDiscoverySchema>
