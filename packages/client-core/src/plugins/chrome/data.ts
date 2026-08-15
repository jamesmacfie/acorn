import { createSignal } from 'solid-js'
import type {
  PluginAttentionWireItem,
  PluginNodeStatValue,
  PluginRailItem,
  PluginSlotBadge,
} from '@acorn/protocol/api.ts'
import type { PluginExtensionItem } from '@acorn/protocol/extensionPoints.ts'
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
  MAX_REF_RESOLVE_IDENTIFIERS,
  pluginRefResolutionsSchema,
  type PluginRefResolution,
} from '@acorn/protocol/refResolvers.ts'
import { readJson, writeJson } from '../../apiClient'
import { wsOnStatus } from '../../wsClient'
import { ownsTaskOrigin } from './ownership'

// Reading a descriptor's route, and knowing when to read it again
// (docs/plugins.md).
//
// Two things this module is responsible for, and they are both about not trusting the far end.
//
//   CONFINEMENT. The manifest's routes were confined to `/v2/p/<id>/` when the node parsed it — but
//   the manifest reaches this device as a ROSTER ROW, and a roster row is bytes a node sent. The same
//   argument that makes the device hash bundle bytes itself applies to a path it is about to fetch on
//   a plugin's behalf, so the check is repeated here rather than assumed.
//
//   SHAPE. A route body is the plugin's own output. A malformed row is dropped and logged; nothing
//   from a plugin route is allowed to throw into the shell, because the shell drawing this chrome is
//   the whole point of the phase — a bad badge must not take the task footer with it.

// Re-spelled rather than imported, for the reason plugins/frames/scopes.ts gives at length: the
// namespace is node-core's (server/routeRegistry.ts) and @acorn/protocol is forbidden from naming a
// plugin route, so the client holds its own copy of the one string.
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

// One revision for ALL chrome, bumped by the node's content-free status ping and by the polling
// fallback. `ctx.events.status()` carries no payload by design (node-core/server/plugin/types.ts
// calls the channel "an invalidation channel, not an event log"), so there is nothing finer to key on
// without inventing an event type the phase doc explicitly says not to invent.
//
// ponytail: one signal for all chrome. Chrome is a handful of tiny reads; split it per contribution
// only if a refetch cost ever actually shows up.
const [chromeRevision, setChromeRevision] = createSignal(0)
export { chromeRevision }

export const bumpChrome = (): void => {
  // Same rule the poller registry applies: a hidden window is not worth a fan-out.
  if (typeof document !== 'undefined' && document.hidden) return
  setChromeRevision((revision) => revision + 1)
}

// Subscribed on the first pass that registers any chrome rather than at module scope, because
// `wsOnStatus` opens the socket as a side effect and a bare import must not do that.
let unsubscribe: (() => void) | null = null
let interval: ReturnType<typeof setInterval> | null = null

/** Start (or restart) the freshness wiring for the descriptors currently registered. `refreshSeconds`
 * is the smallest polling fallback any of them declared, or undefined when none did. */
export function watchChrome(refreshSeconds: number | undefined): void {
  unsubscribe ??= wsOnStatus(bumpChrome)
  if (interval) clearInterval(interval)
  interval = refreshSeconds === undefined ? null : setInterval(bumpChrome, refreshSeconds * 1_000)
}

/** Torn down with the contributions themselves, so a disabled plugin stops costing a timer. */
export function unwatchChrome(): void {
  unsubscribe?.()
  unsubscribe = null
  if (interval) clearInterval(interval)
  interval = null
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────

// Private to chrome. The fan-out writes through the node's QueryClient (node/fanout.ts states the
// rule), so a key shared with a domain reader would have to share its value shape; nothing else in
// the app has this shape. `nodeId` is absent on purpose — the cache is already partitioned per node.
export const chromeKey = (pluginId: string, contributionId: string): readonly unknown[] =>
  ['plugin-chrome', pluginId, contributionId]

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

/** Parse plugin row data field by field. A malformed optional task claim loses that claim; it does
 * not get to erase an otherwise useful row from the host-owned source list. */
export const sanitizeRailItem = (pluginId: string, row: unknown): PluginRailItem | null => {
  const item = row as PluginRailItem
  if (!item || typeof item !== 'object' || !str(item.id) || !str(item.title)
    || !opt(item.subtitle) || !opt(item.icon) || !opt(item.badge)) return null
  if (!item.task || typeof item.task !== 'object') {
    return { id: item.id, title: item.title, ...(str(item.subtitle) ? { subtitle: item.subtitle } : {}),
      ...(str(item.icon) ? { icon: item.icon } : {}), ...(str(item.badge) ? { badge: item.badge } : {}) }
  }
  const task = item.task
  const link = railLink(task.link)
  return {
    id: item.id,
    title: item.title,
    ...(str(item.subtitle) ? { subtitle: item.subtitle } : {}),
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

// One row a cooperative extension point delivers. Display strings only — there is no `action` on the
// wire, because the verb was declared once on the contribution and checked when the node parsed the
// manifest. That is the difference between a descriptor crossing a plugin boundary and a plugin handing
// another plugin's surface something to run.
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

/** A contribution's rows, read from the CONTRIBUTOR's own namespace. Per-row sanitising rather than
 *  all-or-nothing, exactly as the rail list is: these are drawn inside somebody else's surface, and one
 *  malformed row must not blank a section the owner reserved. */
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

// ── Agent context ─────────────────────────────────────────────────────────────────────────────────
//
// The one descriptor pair whose answer leaves the shell and enters a model's prompt, so it is held to
// a stricter standard than the badges above: a real parser (@acorn/protocol/agentContext.ts) rather
// than a field-by-field sniff, and a hard refusal instead of a truncation when it is too big.
//
// No `AbortSignal` here, unlike every reader above, because there is no query: the composer calls
// these when a person clicks, and its own capture-version guard already discards a stale answer.

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
    // Same answer as a malformed badge: the picker offers nothing rather than offering something the
    // host cannot reason about. All-or-nothing rather than per-row, because an option list with holes
    // in it silently hides things a person expected to be able to attach.
    drop(pluginId, 'agent context option list', body)
    return []
  }
  return parsed.data
}

/** What the HOST binds on a captured snapshot, none of it readable from the plugin's response. */
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
  // Rejected outright, not trimmed to fit. Truncating someone's API schema or query text in the middle
  // produces a snapshot that looks complete to an agent and is not, which is worse than no snapshot;
  // and unlike a malformed row this is worth telling the person about, so it throws into the
  // composer's error line rather than disappearing into a console warning.
  if (agentContextBudget(snapshots).overLimit) {
    throw new Error(`${pluginId} returned more than ${MAX_AGENT_CONTEXT_BYTES / 1024} KiB of context; nothing was attached.`)
  }
  return snapshots
}

// ── Ref resolution ────────────────────────────────────────────────────────────────────────────────
//
// The cross-plugin enrichment POST (@acorn/protocol/refResolvers.ts). Same posture as the capture above
// — real parser, host-bound provenance — with one extra reason for care: this route spends the
// provider's credentials on a cache miss, which is why the identifier list is capped HERE as well as in
// the schema. It is already behind `requireProviderAccess` through the provider mount on the node; that
// gate is the authorisation and this cap is the budget, and neither replaces the other.
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
    // All-or-nothing, like the option list: a partially-parsed set would render some refs enriched and
    // others bare, which reads as "that ticket does not exist" rather than "the plugin answered badly".
    drop(pluginId, 'ref resolutions', body)
    return []
  }
  // `providerId` is stamped from the plugin whose route answered, never read from the row. A resolver
  // that could name its own provider could put its rows behind a stranger's reference panel.
  return parsed.data.map((row) => ({ ...row, providerId: pluginId }))
}

export async function readStat(pluginId: string, path: string, nodeId: string, signal: AbortSignal): Promise<number> {
  const body = await read<PluginNodeStatValue>(pluginId, path, nodeId, signal)
  // A stat that is not a number is hidden the same way a failed fetch is — Fleet home already treats
  // `0` as "nothing to report" (registries/nodeStats.ts).
  if (!Number.isFinite(body?.value)) {
    drop(pluginId, 'stat', body)
    return 0
  }
  return body.value
}
