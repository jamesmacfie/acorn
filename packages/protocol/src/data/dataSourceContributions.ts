import { z } from 'zod'
import { parseDataPointer } from './values/dataValues'

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

// A derived source names other statically registered sources as inputs. The host reads them for it,
// with the accounts each query binds in `scope.inputs`, so it never owns a provider of its own.
export const DATA_SOURCE_INPUT_NAME = /^[a-z][a-zA-Z0-9]{0,31}$/
export const dataSourceInputSchema = z.object({
  source: z.string().regex(/^[^:]+:.+$/, 'Expected <pluginId>:<sourceId>').max(401),
  label: z.string().min(1).max(80),
  optional: z.boolean().optional(),
}).strict()
export const dataSourceInputsSchema = z.record(z.string().regex(DATA_SOURCE_INPUT_NAME), dataSourceInputSchema)
  .refine(inputs => Object.keys(inputs).length <= 8, 'A source may declare at most eight inputs')

export const dataSourceRegistrationSchema = dataSourceDescriptorSchema.extend({
  handler: z.string().min(1).max(2048),
  inputs: dataSourceInputsSchema.optional(),
})

export const SOURCE_INPUTS_WITH_PROVIDER = "A source with inputs can't also own a provider."

/** Split an input's `<pluginId>:<sourceId>`. A source id may itself contain colons. */
export function parseDataSourceInputRef(source: string): { pluginId: string; sourceId: string } {
  const split = source.indexOf(':')
  return { pluginId: source.slice(0, split), sourceId: source.slice(split + 1) }
}

export const dataSourceDiscoverySchema = z.object({
  discoveryId: id,
  handler: z.string().min(1).max(2048),
  providerId: id.optional(),
}).strict()

export type DataSourceDescriptor = z.infer<typeof dataSourceDescriptorSchema>
export type DataSourceRegistration = z.infer<typeof dataSourceRegistrationSchema>
export type DataSourceInput = z.infer<typeof dataSourceInputSchema>
export type DataSourceDiscovery = z.infer<typeof dataSourceDiscoverySchema>
