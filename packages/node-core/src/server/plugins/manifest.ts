// Parses acorn-plugin.json at the disk trust boundary. Protocol owns field shapes shared with clients;
// manifestValidation owns Node-only checks that connect fields across a package. The host binds
// namespaces, storage, and permissions from the parsed id.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { NODE_CORE_FACETS } from './coreFacets'
import { pluginManifestShape, CONTRIBUTION_KINDS } from '@acorn/protocol/plugin/contract.ts'
import { validateDependencies, validateNodeDeclarations, validateRuntimeContributions } from './manifestValidation/node'
import { validateFrames, validateSurfaceDestinations } from './manifestValidation/surfaces'
import { validateChrome } from './manifestValidation/chrome'
import { validateExtensions } from './manifestValidation/extensions'
import { ManifestReferences, validateContributionIds } from './manifestValidation/references'

// Keep this as the Node-facing import for protocol manifest types.
export { PLUGIN_API_MAJOR, speaksApiVersion } from '@acorn/protocol/plugin/apiVersion.ts'
export type {
  NodePermissions,
  PluginAgentContextDescriptor,
  PluginAuditActionDescriptor,
  PluginChromeAction,
  PluginClientRouteDescriptor,
  PluginCommandDescriptor,
  PluginDocumentRegion,
  PluginExtensionDescriptor,
  PluginExtensionPointDescriptor,
  PluginFrameSurface,
  PluginHarnessDescriptor,
  PluginAgentToolDescriptor,
  PluginContextSectionDescriptor,
  PluginKeybindingDescriptor,
  PluginPaneRegion,
  PluginRefResolverDescriptor,
  PluginScheduleDescriptor,
  PluginTaskCheckDescriptor,
} from '@acorn/protocol/plugin/contract.ts'
export type { PluginCliCommandDescriptor } from '@acorn/protocol/plugin/cliCommands.ts'

// Cross-field checks run after protocol field parsing, in the order reported to plugin authors.
export const pluginManifestSchema = pluginManifestShape.superRefine((manifest, ctx) => {
  validateDependencies(manifest, ctx)
  // The renderer reserves `x` for loaded plugin pages. Keep this spelling beside the schema; the
  // architecture test checks it against the client's independently owned route segment.
  const ownPath = `/p/:projectId/x/${manifest.id}/`
  const refs = new ManifestReferences(manifest, ctx)
  validateNodeDeclarations(refs)
  validateFrames(refs)
  validateChrome(refs)
  validateRuntimeContributions(refs)
  validateExtensions(refs)
  validateSurfaceDestinations(refs, ownPath)
  validateContributionIds(refs)
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

export const MANIFEST_FILE = 'acorn-plugin.json'

// Keep roster errors short enough to read while retaining the first actionable paths.
const MAX_REPORTED_ISSUES = 3

// Report ignored fields without rejecting a manifest from a newer API version. Compare raw input
// with parsed output so this list stays aligned with the protocol schema.
export type ManifestUnknown = readonly string[]

export type PluginManifestResult =
  | { ok: true; manifest: PluginManifest; unknown: ManifestUnknown }
  | { ok: false; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const droppedKeys = (raw: unknown, kept: object, prefix: string): string[] =>
  isRecord(raw) ? Object.keys(raw).filter((key) => !(key in kept)).map((key) => `${prefix}${key}`) : []

function unknownIn(json: unknown, manifest: PluginManifest): string[] {
  if (!isRecord(json)) return []
  const contributions = isRecord(json.contributions) ? json.contributions : {}
  const permissions = isRecord(json.permissions) ? json.permissions : {}
  const node = isRecord(permissions.node) ? permissions.node : {}
  return [
    ...droppedKeys(json, manifest, ''),
    // Contributions keep unknown keys; compare against the schema's known kind list.
    ...Object.keys(contributions).filter((kind) => !CONTRIBUTION_KINDS.includes(kind)).map((kind) => `contributions.${kind}`),
    ...droppedKeys(permissions, manifest.permissions, 'permissions.'),
    ...droppedKeys(node, manifest.permissions.node, 'permissions.node.'),
    // Core facets are array values, so key comparison cannot find unknown entries.
    ...manifest.permissions.node.core
      .filter((facet) => !(NODE_CORE_FACETS as readonly string[]).includes(facet))
      .map((facet) => `permissions.node.core: ${facet}`),
  ]
}

/** Validate a parsed object and retain field paths in the author-facing error. The testkit uses the
 * same rules for acorn-plugin.config.mjs before the builder writes JSON. */
export function parsePluginManifest(json: unknown, source: string = MANIFEST_FILE): PluginManifestResult {
  const rawContributions = isRecord(json) && isRecord(json.contributions) ? json.contributions : undefined
  if (rawContributions && 'palette' in rawContributions) {
    return {
      ok: false,
      reason: `${source} uses removed contributions.palette. Put each entry in contributions.commands with an explicit kind.`,
    }
  }
  if (rawContributions && Array.isArray(rawContributions.commands)) {
    const missing = rawContributions.commands.findIndex((entry) => isRecord(entry) && !('kind' in entry))
    if (missing !== -1) {
      return {
        ok: false,
        reason: `${source} contributions.commands[${missing}].kind is required. Choose action, group, search, input, or setting.`,
      }
    }
  }
  if (rawContributions && 'collections' in rawContributions) {
    return {
      ok: false,
      reason: `${source} uses removed contributions.collections. Register a Node-owned contributions.dataSources entry and migrate dashboards to typed queries.`,
    }
  }
  const parsed = pluginManifestSchema.safeParse(json)
  if (parsed.success) return { ok: true, manifest: parsed.data, unknown: unknownIn(json, parsed.data) }
  // Keep the path so an author can find the failing descriptor.
  const issues = parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  const extra = parsed.error.issues.length - issues.length
  return { ok: false, reason: `${source} does not match the manifest schema — ${issues.join('; ')}${extra > 0 ? ` (and ${extra} more)` : ''}` }
}

/** Read a plugin directory without throwing, and return a reason when its manifest fails. */
export function readPluginManifestResult(dir: string): PluginManifestResult {
  let text: string
  try {
    text = readFileSync(join(dir, MANIFEST_FILE), 'utf8')
  } catch (error) {
    return { ok: false, reason: `${MANIFEST_FILE} is missing or unreadable: ${error instanceof Error ? error.message : String(error)}` }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `${MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  return parsePluginManifest(json)
}

// For callers that need only the manifest; loader and installer use the result with its reason.
export function readPluginManifest(dir: string): PluginManifest | null {
  const result = readPluginManifestResult(dir)
  return result.ok ? result.manifest : null
}
