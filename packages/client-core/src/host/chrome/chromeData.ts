import { createSignal } from 'solid-js'
import type {
  PluginAttentionWireItem,
  PluginNodeStatValue,
  PluginRailItem,
  PluginSlotBadge,
} from '@acorn/protocol/api.ts'
import { isAnnotationSeverity, type PluginAnnotationKey, type PluginAnnotationMark, type PluginExtensionItem } from '@acorn/protocol/extensionPoints.ts'
import {
  agentContextBudget,
  MAX_AGENT_CONTEXT_BYTES,
  pluginAgentContextOptionsSchema,
  pluginAgentContextSnapshotsSchema,
  type AgentContextCaptureScope,
  type AgentContextOption,
  type AgentContextSnapshot,
} from '@acorn/protocol/agentContext.ts'
import {
  pluginCollectionResponseSchema,
  type PluginCollectionPage,
} from '@acorn/protocol/collections.ts'
import {
  MAX_REF_RESOLVE_IDENTIFIERS,
  pluginRefResolutionsSchema,
  type PluginRefResolution,
} from '@acorn/protocol/refResolvers.ts'
import { emptyCollectionPage } from '../registries/sources/collections'
import { readJson, writeJson } from '../../infra/node/apiClient'
import { wsOnStatus } from '../../infra/node/wsClient'
import { onPluginPush } from '../plugins/pluginChannel'
import { ownsTaskOrigin } from './ownership'

// Reads a plugin's descriptor routes (badges, rail items, collections, agent context). The manifest's
// routes were confined to `/v2/p/<id>/` at parse time, but this arrives as a roster row, so the path is
// re-checked here and a malformed body is dropped rather than thrown into the shell chrome
// (docs/security.md § Third-party plugin bundles; docs/plugins.md § Cooperative extension points).

// Re-spelled rather than imported: the namespace is node-core's (server/routeRegistry.ts) and
// @acorn/protocol may not name a plugin route, so the client holds its own copy. See
// plugins/frames/scopes.ts.
const PLUGIN_NAMESPACE = '/v2/p/'

/** The path a descriptor may address. Normalize dot segments before checking so an apparently owned
 * `/v2/p/id/../other` route cannot escape after URL parsing. */
export const ownsRoute = (pluginId: string, path: string): boolean => {
  if (!path.startsWith('/')) return false
  try {
    const url = new URL(path, 'https://acorn.invalid')
    return url.origin === 'https://acorn.invalid' && url.pathname.startsWith(`${PLUGIN_NAMESPACE}${pluginId}/`)
  } catch {
    return false
  }
}

// ── Freshness ─────────────────────────────────────────────────────────────────────────────────────

// Two revisions, and a descriptor read watches both.
//
// The shared one is bumped by the polling fallback and by a status ping that names no plugin, which is
// core's own way of saying "anyone's rows may have moved" — a task created, a worktree appearing. A
// plugin's own ping names itself and lands on the per-plugin revision below.
//
// The per-plugin one is for a plugin pushing on its own channel (plugins/pluginChannel.ts). Without
// it, a plugin sampling every two seconds re-reads every other plugin's badges and rail rows at the
// same cadence. The split is per plugin rather than per contribution.
const [chromeRevision, setChromeRevision] = createSignal(0)
export { chromeRevision }

// Created on demand, because a plugin that never pushes should not cost a signal. Plain signals at
// module scope need no reactive owner; only computations would.
const pluginRevisions = new Map<string, { read: () => number; bump: () => void }>()

const revisionFor = (pluginId: string): { read: () => number; bump: () => void } => {
  let entry = pluginRevisions.get(pluginId)
  if (!entry) {
    const [read, set] = createSignal(0)
    entry = { read, bump: () => void set((revision) => revision + 1) }
    pluginRevisions.set(pluginId, entry)
  }
  return entry
}

/** One plugin's own freshness. */
export const pluginRevision = (pluginId: string): number => revisionFor(pluginId).read()

/** The freshness dependency a descriptor read watches: the shared revision plus this plugin's own, so
 *  a status ping invalidates everyone's and a push invalidates only its sender's. Both counters only
 *  increase, so the sum never lands back on a value a query has already seen. */
export const chromeDeps = (pluginId: string): number => chromeRevision() + pluginRevision(pluginId)

/** Nudge chrome. With no argument every descriptor refetches, which is what a content-free status ping
 *  means. With a plugin id, only that plugin's. */
export const bumpChrome = (pluginId?: string): void => {
  // Same rule the poller registry applies: a hidden window is not worth a fan-out.
  if (typeof document !== 'undefined' && document.hidden) return
  if (pluginId === undefined) return void setChromeRevision((revision) => revision + 1)
  revisionFor(pluginId).bump()
}

// Subscribed on the first pass that registers any chrome rather than at module scope, because both
// subscriptions open the socket as a side effect and a bare import must not do that.
let unsubscribe: (() => void) | null = null
let unsubscribePush: (() => void) | null = null
let interval: ReturnType<typeof setInterval> | null = null

/** Start (or restart) the freshness wiring for the descriptors currently registered. `refreshSeconds`
 * is the smallest polling fallback any of them declared, or undefined when none did. */
export function watchChrome(refreshSeconds: number | undefined): void {
  // The plugin id, forwarded. This was the one caller that passed nothing, so every ping refetched
  // every plugin's descriptor routes (docs/performance.md § Corrections to the first
  // reads). Core's own pings still carry no id, which still means everyone's.
  unsubscribe ??= wsOnStatus((pluginId) => bumpChrome(pluginId))
  unsubscribePush ??= onPluginPush(bumpChrome)
  if (interval) clearInterval(interval)
  interval = refreshSeconds === undefined ? null : setInterval(() => bumpChrome(), refreshSeconds * 1_000)
}

/** Torn down with the contributions themselves, so a disabled plugin stops costing a timer. */
export function unwatchChrome(): void {
  unsubscribe?.()
  unsubscribe = null
  unsubscribePush?.()
  unsubscribePush = null
  if (interval) clearInterval(interval)
  interval = null
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────

// Private to chrome. `nodeId` is absent on purpose: the cache is already partitioned per node.
// `scope` is whatever else went into the path, so far only the rail's project that
// `scopedSourceItemsPath` appends. It has to be in the key, because the cache is served on mount and a
// key naming only the source would hand the next project the previous project's rows.
export const chromeKey = (pluginId: string, contributionId: string, scope?: string): readonly unknown[] =>
  scope ? ['plugin-chrome', pluginId, contributionId, scope] : ['plugin-chrome', pluginId, contributionId]

/** Add the shell's active project without letting a plugin choose another node or namespace. Extra
 * query parameters are advisory scope; plugins that are not project-aware simply ignore them. */
export const scopedSourceItemsPath = (path: string, projectId: string | undefined): string => {
  if (!projectId) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}project=${encodeURIComponent(projectId)}`
}

// `signal` is optional only for the agent-context reads below; every query-backed reader has one.
async function read<T>(pluginId: string, path: string, nodeId: string, signal?: AbortSignal): Promise<T> {
  if (!ownsRoute(pluginId, path)) throw new Error(`${pluginId} may not read ${path}`)
  return readJson<T>(path, { nodeId, signal })
}

const str = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const opt = (value: unknown): boolean => value === undefined || str(value)
const stringRecord = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every((entry) => typeof entry === 'string')

const drop = (pluginId: string, what: string, row: unknown): void =>
  console.warn(`[plugin-chrome] ${pluginId} returned an unusable ${what}:`, row)

const railLink = (value: unknown): NonNullable<NonNullable<PluginRailItem['task']>['link']> | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const link = value as NonNullable<NonNullable<PluginRailItem['task']>['link']>
  const ref = link.ref
  if (!str(link.connectionId) || !str(link.identifier)) return undefined
  if (ref !== undefined && (!ref || typeof ref !== 'object' || !str(ref.displayId)
    || !opt(ref.externalId) || !opt(ref.url)
    || (ref.locator !== undefined && !stringRecord(ref.locator)))) return undefined
  return link
}

// Empty strings stay: `fields` is positional (protocol/api.ts § PluginRailItem), so an empty cell
// holds its column.
const fieldList = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')
    ? value : undefined

/** Parse plugin row data field by field. A malformed optional task claim loses that claim; it does
 * not get to erase an otherwise useful row from the host-owned source list. */
export const sanitizeRailItem = (pluginId: string, row: unknown): PluginRailItem | null => {
  const item = row as PluginRailItem
  if (!item || typeof item !== 'object' || !str(item.id) || !str(item.title)
    || !opt(item.subtitle) || !opt(item.icon) || !opt(item.badge)) return null
  const fields = fieldList(item.fields)
  if (!item.task || typeof item.task !== 'object') {
    return { id: item.id, title: item.title, ...(str(item.subtitle) ? { subtitle: item.subtitle } : {}),
      ...(fields ? { fields } : {}),
      ...(str(item.icon) ? { icon: item.icon } : {}), ...(str(item.badge) ? { badge: item.badge } : {}) }
  }
  const task = item.task
  const link = railLink(task.link)
  return {
    id: item.id,
    title: item.title,
    ...(str(item.subtitle) ? { subtitle: item.subtitle } : {}),
    ...(fields ? { fields } : {}),
    ...(str(item.icon) ? { icon: item.icon } : {}),
    ...(str(item.badge) ? { badge: item.badge } : {}),
    task: {
      ...(str(task.origin) && ownsTaskOrigin(pluginId, task.origin) ? { origin: task.origin } : {}),
      ...(str(task.title) ? { title: task.title } : {}),
      ...(str(task.branch) ? { branch: task.branch } : {}),
      ...(str(task.body) ? { body: task.body } : {}),
      ...(link ? { link } : {}),
    },
  }
}

export async function readRailItems(pluginId: string, path: string, nodeId: string, signal: AbortSignal): Promise<PluginRailItem[]> {
  const body = await read<{ items?: unknown }>(pluginId, path, nodeId, signal)
  const rows = Array.isArray(body?.items) ? body.items : []
  return rows.flatMap((row) => {
    const item = sanitizeRailItem(pluginId, row)
    if (item) return [item]
    drop(pluginId, 'rail item', row)
    return []
  })
}

const TONES = new Set(['neutral', 'accent', 'warn'])

export async function readBadge(pluginId: string, path: string, nodeId: string, signal: AbortSignal): Promise<PluginSlotBadge> {
  const body = await read<unknown>(pluginId, path, nodeId, signal)
  // `null` is the documented "nothing to say" answer, not a failure.
  if (body === null || body === undefined) return null
  const badge = body as NonNullable<PluginSlotBadge>
  if (!str(badge.text) || !opt(badge.tooltip) || (badge.tone !== undefined && !TONES.has(badge.tone))) {
    drop(pluginId, 'badge', body)
    return null
  }
  return badge
}

const SEVERITIES = new Set(['info', 'warn', 'danger'])

const isAttentionItem = (row: unknown): row is PluginAttentionWireItem => {
  const item = row as PluginAttentionWireItem
  return !!item && typeof item === 'object'
    && str(item.id) && str(item.title) && opt(item.detail) && opt(item.taskId)
    && SEVERITIES.has(item.severity) && Number.isFinite(item.at)
}

export async function readAttention(pluginId: string, path: string, nodeId: string, signal: AbortSignal): Promise<PluginAttentionWireItem[]> {
  const body = await read<{ items?: unknown }>(pluginId, path, nodeId, signal)
  const rows = Array.isArray(body?.items) ? body.items : []
  return rows.filter((row) => isAttentionItem(row) || (drop(pluginId, 'attention item', row), false)) as PluginAttentionWireItem[]
}

// One row a cooperative extension point delivers. Display strings only. There is no `action` on the
// wire, because the verb was declared on the contribution and checked when the node parsed the
// manifest.
export const sanitizeExtensionItem = (row: unknown): PluginExtensionItem | null => {
  const item = row as PluginExtensionItem
  if (!item || typeof item !== 'object' || !str(item.id) || !str(item.title)
    || !opt(item.subtitle) || !opt(item.icon) || !opt(item.badge)) return null
  return {
    id: item.id,
    title: item.title,
    ...(str(item.subtitle) ? { subtitle: item.subtitle } : {}),
    ...(str(item.icon) ? { icon: item.icon } : {}),
    ...(str(item.badge) ? { badge: item.badge } : {}),
  }
}

/** A contribution's rows, read from the contributor's own namespace. Per-row sanitising rather than
 *  all-or-nothing, like the rail list: these draw inside somebody else's surface, and one malformed
 *  row must not blank a section the owner reserved. */
export async function readExtensionItems(
  pluginId: string,
  path: string,
  nodeId: string,
  signal: AbortSignal,
): Promise<PluginExtensionItem[]> {
  const body = await read<{ items?: unknown }>(pluginId, path, nodeId, signal)
  const rows = Array.isArray(body?.items) ? body.items : []
  return rows.flatMap((row) => {
    const item = sanitizeExtensionItem(row)
    if (item) return [item]
    drop(pluginId, 'extension item', row)
    return []
  })
}

/**
 * A contribution's marks for the keys the owner is drawing, in one request
 * (docs/plugins.md § Cooperative extension points, the `annotation` kind).
 *
 * A POST rather than a GET, alone among the descriptor reads, because the question is "what do you
 * know about these two thousand items" and two thousand items do not fit in a query string. It is
 * still a read: the host sends the owner's keys, the contributor answers facts, and nothing is
 * created.
 *
 * Per-mark sanitising rather than all-or-nothing, like the rows above and the rail list: these draw
 * inside somebody else's surface, and one malformed mark must not blank the rest.
 */
export async function readAnnotationMarks(
  pluginId: string,
  path: string,
  nodeId: string,
  keys: readonly PluginAnnotationKey[],
  signal: AbortSignal,
): Promise<PluginAnnotationMark[]> {
  if (!ownsRoute(pluginId, path)) throw new Error(`${pluginId} may not read ${path}`)
  const body = await writeJson<{ items?: unknown }>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys }),
    nodeId,
    signal,
  })
  const rows = Array.isArray(body?.items) ? body.items : []
  return rows.flatMap((row) => {
    const mark = sanitizeAnnotationMark(row)
    if (mark) return [mark]
    drop(pluginId, 'annotation mark', row)
    return []
  })
}

/** One mark, reduced to what the host is willing to draw: a key of scalars, one of three severities, a
 *  line of text and an optional icon name. No colour, no markup, no verb. */
function sanitizeAnnotationMark(row: unknown): PluginAnnotationMark | null {
  if (!row || typeof row !== 'object') return null
  const mark = row as Record<string, unknown>
  if (!str(mark.text) || !isAnnotationSeverity(mark.severity)) return null
  if (!mark.key || typeof mark.key !== 'object' || Array.isArray(mark.key)) return null
  const key: PluginAnnotationKey = {}
  for (const [field, value] of Object.entries(mark.key as Record<string, unknown>)) {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    key[field] = value
  }
  return {
    key,
    severity: mark.severity,
    // Capped like every other display string a plugin sends: this lands under a diff row, not in a
    // pane of its own.
    text: mark.text.slice(0, 200),
    ...(str(mark.icon) ? { icon: mark.icon } : {}),
  }
}

// ── Agent context ─────────────────────────────────────────────────────────────────────────────────
//
// The one descriptor pair whose answer enters a model's prompt, so it is held to a stricter standard
// than the badges above: a real parser (@acorn/protocol/agentContext.ts) rather than a field-by-field
// sniff, and a refusal instead of a truncation when it is too big.
//
// No `AbortSignal`, because there is no query. The composer calls these on a click and its own
// capture-version guard discards a stale answer.

/** Scope rides as query parameters, minted here so a plugin route cannot see a node or a task the
 * composer did not name. */
const scopedContextPath = (path: string, scope: AgentContextCaptureScope): string => {
  const separator = path.includes('?') ? '&' : '?'
  const query = new URLSearchParams({ taskId: scope.taskId })
  if (scope.workspaceId) query.set('workspaceId', scope.workspaceId)
  return `${path}${separator}${query.toString()}`
}

export async function readAgentContextOptions(
  pluginId: string,
  path: string,
  nodeId: string,
  scope: AgentContextCaptureScope,
): Promise<AgentContextOption[]> {
  const body = await read<unknown>(pluginId, scopedContextPath(path, scope), nodeId)
  const parsed = pluginAgentContextOptionsSchema.safeParse(body)
  if (!parsed.success) {
    // All-or-nothing rather than per-row, because an option list with holes in it silently hides
    // things a person expected to be able to attach.
    drop(pluginId, 'agent context option list', body)
    return []
  }
  return parsed.data
}

/** What the host binds on a captured snapshot, none of it readable from the plugin's response. */
export type AgentContextBinding = {
  // Derived from the plugin id by the caller, never taken from the manifest. The composer groups and
  // replaces snapshots by `source`, so a plugin naming another's would evict its context.
  source: string
  // The panes this plugin's own manifest declares. A deep link naming anything else is dropped.
  panes: ReadonlySet<string>
}

export async function captureAgentContext(
  pluginId: string,
  path: string,
  nodeId: string,
  scope: AgentContextCaptureScope,
  optionIds: readonly string[] | undefined,
  binding: AgentContextBinding,
): Promise<AgentContextSnapshot[]> {
  if (!ownsRoute(pluginId, path)) throw new Error(`${pluginId} may not read ${path}`)
  const body = await writeJson<unknown>(path, {
    method: 'POST',
    nodeId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      taskId: scope.taskId,
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      ...(optionIds ? { optionIds: [...optionIds] } : {}),
    }),
  })
  const parsed = pluginAgentContextSnapshotsSchema.safeParse(body)
  if (!parsed.success) {
    drop(pluginId, 'agent context capture', body)
    return []
  }
  const capturedAt = Date.now()
  const snapshots = parsed.data.map((row): AgentContextSnapshot => {
    const byteSize = new TextEncoder().encode(row.content).byteLength
    return {
      type: 'context',
      // Namespaced for the same reason attention rows are: the composer removes a snapshot by
      // `contextId` equality, so two plugins both answering `card-1` would remove each other's.
      contextId: `${binding.source}:${row.contextId}`,
      label: row.label,
      content: row.content,
      source: binding.source,
      ...(row.resourceId ? { resourceId: row.resourceId } : {}),
      ...(row.provenance ? { provenance: row.provenance } : {}),
      ...(row.deepLink && binding.panes.has(row.deepLink.pane) ? { deepLink: row.deepLink } : {}),
      byteSize,
      estimatedTokens: Math.ceil(byteSize / 4),
      ...(row.freshness ? { freshness: row.freshness } : {}),
      ...(row.sensitivity ? { sensitivity: row.sensitivity } : {}),
      capturedAt,
    }
  })
  // Rejected outright, not trimmed to fit. A truncated schema or query looks complete to an agent and
  // is not. This one is worth telling the person about, so it throws into the composer's error line
  // rather than a console warning.
  if (agentContextBudget(snapshots).overLimit) {
    throw new Error(`${pluginId} returned more than ${MAX_AGENT_CONTEXT_BYTES / 1024} KiB of context; nothing was attached.`)
  }
  return snapshots
}

// ── Ref resolution ────────────────────────────────────────────────────────────────────────────────
//
// The cross-plugin enrichment POST (@acorn/protocol/refResolvers.ts). Same posture as the capture
// above: a real parser and host-bound provenance. This route spends the provider's credentials on a
// cache miss, so the identifier list is capped here as well as in the schema. `requireProviderAccess`
// on the node is the authorisation, this cap is the budget.
export async function resolveRefs(
  pluginId: string,
  path: string,
  nodeId: string,
  identifiers: readonly string[],
): Promise<PluginRefResolution[]> {
  if (!ownsRoute(pluginId, path)) throw new Error(`${pluginId} may not read ${path}`)
  const wanted = identifiers.slice(0, MAX_REF_RESOLVE_IDENTIFIERS)
  if (!wanted.length) return []
  const body = await writeJson<unknown>(path, {
    method: 'POST',
    nodeId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifiers: wanted }),
  })
  const parsed = pluginRefResolutionsSchema.safeParse(body)
  if (!parsed.success) {
    // All-or-nothing, like the option list. Some refs enriched and others bare reads as "that ticket
    // does not exist" rather than "the plugin answered badly".
    drop(pluginId, 'ref resolutions', body)
    return []
  }
  // `providerId` is stamped from the plugin whose route answered, never read from the row. A resolver
  // that could name its own provider could put its rows behind a stranger's reference panel.
  return parsed.data.map((row) => ({ ...row, providerId: pluginId }))
}

// ── Collections ───────────────────────────────────────────────────────────────────────────────────
//
// The third parsed descriptor response (@acorn/protocol/collections.ts). These rows draw as the host's
// own table beside another plugin's rows, so the reader cannot tell whose answer was malformed.

/** Declared params ride as query parameters, minted here rather than pasted onto the path by a caller,
 * so a collection route cannot be handed a second `nodeId` or a scope it was not given. */
const collectionItemsPath = (path: string, params: Record<string, string>): string => {
  const query = new URLSearchParams(params).toString()
  if (!query) return path
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

/** One collection's page, parsed and stamped. */
export async function readCollection(
  pluginId: string,
  collectionId: string,
  path: string,
  nodeId: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<PluginCollectionPage> {
  const body = await read<unknown>(pluginId, collectionItemsPath(path, params), nodeId, signal)
  const parsed = pluginCollectionResponseSchema.safeParse(body)
  if (!parsed.success) {
    // All-or-nothing, unlike the per-row rail sanitiser. A half-parsed collection renders a
    // complete-looking list missing the row someone was looking for. An empty panel says nothing
    // instead of saying something false.
    drop(pluginId, `collection '${collectionId}'`, body)
    return emptyCollectionPage()
  }
  // Provenance is stamped from the contribution whose route answered, never read from the row, the
  // same rule `resolveRefs` applies to `providerId`. A mixed board renders source badges and row
  // actions on this stamp, so a row naming its own plugin could put its clicks into a stranger's pane.
  // The schema omits both fields, so a body that states them is stripped before this line runs.
  return {
    schema: parsed.data.schema,
    rows: parsed.data.rows.map((row) => ({ ...row, pluginId, collectionId })),
  }
}

export async function readStat(pluginId: string, path: string, nodeId: string, signal: AbortSignal): Promise<number> {
  const body = await read<PluginNodeStatValue>(pluginId, path, nodeId, signal)
  // A stat that is not a number is hidden the same way a failed fetch is. Fleet home already treats
  // `0` as "nothing to report" (registries/nodeStats.ts).
  if (!Number.isFinite(body?.value)) {
    drop(pluginId, 'stat', body)
    return 0
  }
  return body.value
}
