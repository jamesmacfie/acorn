import { z } from 'zod'
import { parseDataPointer } from './values/dataValues'

// Keep the manifest carrier independent of the invocation contract. Every client parses installed
// plugin manifests during startup, while query schemas and value validation belong to the lazy data
// authoring/runtime paths. Pulling the complete source protocol through the plugin contract would put
// those execution-only schemas in both clients' first-frame graph.
const id = z.string().min(1).max(200)
const pointer = z.string().refine((value) => parseDataPointer(value) !== null, 'Invalid data pointer')

export const dataSourceDescriptorSchema = z
  .object({
    sourceId: id.describe("The source's ID, unique in this manifest. Others name it as `<pluginId>:<sourceId>`."),
    name: z.string().min(1).max(80).describe("The source's name, such as `Release readiness`."),
    singular: z.string().min(1).max(80).describe('What one record is called, such as `Issue`.'),
    plural: z.string().min(1).max(80).describe('What several are called, such as `Issues`.'),
    identityScope: z
      .string()
      .min(1)
      .max(2048)
      .describe(
        "A sentence saying what a record's ID is and what keeps it stable, such as `GitHub GraphQL node ID; stable across renames`.",
      ),
    icon: z.string().max(80).optional().describe('A Lucide icon name, or a `brand:` mark.'),
    providerId: id.optional().describe('The integration whose connection each query picks. Not with `inputs`.'),
    titlePointer: pointer.optional().describe('A pointer to the field that titles a record.'),
    urlPointer: pointer.optional().describe("A pointer to the field that holds a record's web address."),
  })
  .strict()

// A derived source names other statically registered sources as inputs. The host reads them for it,
// with the accounts each query binds in `scope.inputs`, so it never owns a provider of its own.
export const DATA_SOURCE_INPUT_NAME = /^[a-z][a-zA-Z0-9]{0,31}$/
const dataSourceInputSchema = z
  .object({
    source: z
      .string()
      .regex(/^[^:]+:.+$/, 'Expected <pluginId>:<sourceId>')
      .max(401)
      .describe(
        'The source this input reads, as `<pluginId>:<sourceId>`. It must be registered statically, not discovered.',
      ),
    label: z.string().min(1).max(80).describe("The input's name where the person picks an account for it."),
    optional: z
      .boolean()
      .optional()
      .describe('Whether the person may skip it. A skipped input is `undefined` in your query.'),
  })
  .strict()
export const dataSourceInputsSchema = z
  .record(z.string().regex(DATA_SOURCE_INPUT_NAME), dataSourceInputSchema)
  .refine((inputs) => Object.keys(inputs).length <= 8, 'A source may declare at most eight inputs')
  .describe(
    'For a derived source: other sources the host reads for you, by input name, at most eight. The person approves them before your plugin reads anything.',
  )

export const dataSourceRegistrationSchema = dataSourceDescriptorSchema.extend({
  handler: z.string().min(1).max(2048).describe("The route on your Node half that answers the source's operations."),
  inputs: dataSourceInputsSchema.optional(),
})

export const SOURCE_INPUTS_WITH_PROVIDER = "A source with inputs can't also own a provider."

/** Split an input's `<pluginId>:<sourceId>`. A source id may itself contain colons. */
export function parseDataSourceInputRef(source: string): { pluginId: string; sourceId: string } {
  const split = source.indexOf(':')
  return { pluginId: source.slice(0, split), sourceId: source.slice(split + 1) }
}

export const dataSourceDiscoverySchema = z
  .object({
    discoveryId: id.describe("The discovery's ID, unique in this manifest."),
    handler: z
      .string()
      .min(1)
      .max(2048)
      .describe(
        'The route on your Node half that lists sources, at most 100 a page. A discovered source is available only in the scope that found it.',
      ),
    providerId: id.optional().describe('The integration whose connection each discovery uses.'),
  })
  .strict()

export type DataSourceDescriptor = z.infer<typeof dataSourceDescriptorSchema>
export type DataSourceRegistration = z.infer<typeof dataSourceRegistrationSchema>
export type DataSourceInput = z.infer<typeof dataSourceInputSchema>
export type DataSourceDiscovery = z.infer<typeof dataSourceDiscoverySchema>
