// What a manifest may declare, read off the contract rather than written down: the keys, the caps,
// the closed enums, and the action verbs. Two readers need the same facts, the `plugin_authoring` agent
// tool and the public site's plugin reference (docs/site/references.md), so an agent and a person never
// see different answers. Core facets aren't here: node-core declares them, and its tool adds them.
import { z } from 'zod'
import { PUBLIC_EXTENSION_POINTS, type PublicExtensionPoint } from '../chrome/publicExtensionPoints.ts'
import { PLUGIN_API_MAJOR } from './apiVersion.ts'
import { pluginManifestShape } from './contract.ts'

// `z.toJSONSchema` rather than reaching into `_def`: the same projection the tool registry uses for
// MCP input schemas, so a zod bump cannot turn it into a runtime throw. `unrepresentable: 'any'`
// because the manifest is full of refinements with no JSON Schema spelling. The fields read here, keys,
// caps, enums and literal verbs, all have one.
export type JsonSchema = {
  properties?: Record<string, JsonSchema>
  additionalProperties?: JsonSchema | boolean
  items?: JsonSchema
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  required?: string[]
  enum?: string[]
  const?: string
  default?: unknown
  description?: string
  type?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
}

let cached: JsonSchema | null = null
/** The manifest as the JSON Schema an author's file is checked against, descriptions included. */
export const manifestJsonSchema = (): JsonSchema =>
  (cached ??= z.toJSONSchema(pluginManifestShape, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema)

const at = (schema: JsonSchema | undefined, ...path: string[]): JsonSchema | undefined =>
  path.reduce<JsonSchema | undefined>((node, key) => node?.properties?.[key], schema)

/**
 * One field off a descriptor's items, where the items may be a union of kinds.
 *
 * A command is five shapes (action, group, search, input, setting), so `items.properties` is only there
 * for the descriptors that are one shape. The first member carrying the field is the answer, because a
 * field two members both declare has the same shape in both.
 */
const field = (items: JsonSchema | undefined, name: string): JsonSchema | undefined =>
  items?.properties?.[name] ??
  (items?.anyOf ?? items?.oneOf ?? []).map((member) => member.properties?.[name]).find(Boolean)

// A discriminated union of `{ verb: '<literal>' }` objects, read back as the literal set. zod emits
// `oneOf` for a discriminated union under draft-7, and `anyOf` is the fallback if that changes. The
// agent tool's test asserts the result is non-empty, so a silent [] cannot ship.
const verbs = (schema: JsonSchema | undefined): string[] =>
  (schema?.oneOf ?? schema?.anyOf ?? [])
    .map((option) => option.properties?.verb?.const ?? '')
    .filter(Boolean)
    .sort()

export type PluginManifestVocabulary = {
  apiMajor: string
  manifest: {
    file: string
    required: string[]
    optional: string[]
    contributionCaps: Record<string, number>
    // Contributions that are one route on the plugin's node half rather than a list.
    contributionRoutes: string[]
    // Contributions that are one object rather than a list, such as `browserPanel`.
    contributionObjects: string[]
    frameTargets: string[]
    slots: string[]
    contextMenuLocations: string[]
    extensionPointLocations: string[]
    coreSlots: string[]
    commandCategories: string[]
    themeTokens: string[]
  }
  actions: { railOnSelect: string[]; commandsAndBadges: string[] }
  /** Every point another plugin can fill. Registered in client code, so read from protocol's list. */
  points: readonly PublicExtensionPoint[]
  /** The `permissions.node` keys. */
  nodePermissions: string[]
}

/** What this build's own schemas say a plugin may declare. Nothing here is written down twice. */
export function pluginManifestVocabulary(): PluginManifestVocabulary {
  const schema = manifestJsonSchema()
  const contributions = at(schema, 'contributions')
  const required = schema.required ?? []
  const kinds = Object.entries(contributions?.properties ?? {})
  const caps = kinds.flatMap(([key, value]) => (value.maxItems === undefined ? [] : [[key, value.maxItems] as const]))
  return {
    apiMajor: PLUGIN_API_MAJOR,
    manifest: {
      file: 'acorn-plugin.json',
      required: [...required].sort(),
      optional: Object.keys(schema.properties ?? {})
        .filter((key) => !required.includes(key))
        .sort(),
      contributionCaps: Object.fromEntries(caps),
      contributionRoutes: kinds.filter(([, value]) => value.type === 'string').map(([key]) => key),
      contributionObjects: kinds.filter(([, value]) => value.type === 'object').map(([key]) => key),
      frameTargets: at(contributions, 'frames')?.items?.properties?.target?.enum ?? [],
      slots: at(contributions, 'slots')?.items?.properties?.slot?.enum ?? [],
      // Read off the schema, not hand-typed. A guessed member is a contribution that parses on a newer
      // node and never appears on this one.
      contextMenuLocations: at(contributions, 'contextMenus')?.items?.properties?.location?.enum ?? [],
      extensionPointLocations: at(contributions, 'extensionPoints')?.items?.properties?.location?.enum ?? [],
      coreSlots: at(contributions, 'frames')?.items?.properties?.coreSlot?.enum ?? [],
      commandCategories: field(at(contributions, 'commands')?.items, 'category')?.enum ?? [],
      // A `themes` entry must carry exactly these token names, and a theme missing one is refused at
      // parse. Read off the strict object the schema builds from the palette
      // (@acorn/protocol/themeTokens.ts), so a new token reaches every reader with no edit here.
      themeTokens: at(contributions, 'themes')?.items?.properties?.tokens?.required ?? [],
    },
    actions: {
      // The two unions, read off the descriptors that carry them. A rail source's `onSelect` is the only
      // site with the full set in scope, and a command's `action` is the narrow one every context-free
      // surface takes.
      railOnSelect: verbs(at(contributions, 'sources')?.items?.properties?.onSelect),
      commandsAndBadges: verbs(field(at(contributions, 'commands')?.items, 'action')),
    },
    points: PUBLIC_EXTENSION_POINTS,
    nodePermissions: Object.keys(at(schema, 'permissions', 'node')?.properties ?? {}),
  }
}
