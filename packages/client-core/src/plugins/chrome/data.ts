import { createSignal } from 'solid-js'
import type {
  PluginAttentionWireItem,
  PluginNodeStatValue,
  PluginRailItem,
  PluginSlotBadge,
} from '@acorn/protocol/api.ts'
import { readJson } from '../../apiClient'
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

async function read<T>(pluginId: string, path: string, nodeId: string, signal: AbortSignal): Promise<T> {
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
