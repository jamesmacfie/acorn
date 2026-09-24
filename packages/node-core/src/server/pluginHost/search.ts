// Search providers: each plugin searches its own data, and core asks every provider at once. See
// docs/plugins.md § Search providers for why results stay grouped and why a plugin answers with hits
// rather than exposing tables.
import type { SearchGroup, SearchHit } from '@acorn/protocol/search.ts'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('search')

/** How long one provider may take. A plugin in a worker keeps running after the owner types the next
 *  letter, because cancellation does not reach it, so the deadline is what keeps a slow one from
 *  holding up the page. */
export const SEARCH_TIMEOUT_MS = 1_500
/** Hits per group, whatever the caller asked for, so one noisy provider cannot flood the page. */
export const SEARCH_HITS_MAX = 20

const TITLE_MAX = 120
const PREVIEW_MAX = 300

/** What a provider is asked. `taskIds` is the scope core already resolved: the tasks the caller may see,
 *  archived or active as asked. A provider returns hits in those tasks only. */
export type SearchQuery = {
  text: string
  limit: number
  taskIds: readonly string[]
}

export type SearchProvider = {
  /** Unique within the plugin. */
  id: string
  /** The group heading. */
  label: string
  /** The signal fires at SEARCH_TIMEOUT_MS. */
  search(query: SearchQuery, signal: AbortSignal): Promise<SearchHit[]>
}

export type RegisteredSearchProvider = SearchProvider & { pluginId: string }

// A module singleton with the same lifecycle as the task-check registry beside it: the plugin host
// clears a plugin's entries before re-registering them (./host.ts § clearRegistrations).
const providers = new Map<string, RegisteredSearchProvider>()

const key = (provider: Pick<RegisteredSearchProvider, 'pluginId' | 'id'>): string => `${provider.pluginId}:${provider.id}`

export function registerSearchProvider(provider: RegisteredSearchProvider): void {
  const id = key(provider)
  if (providers.has(id)) throw new Error(`Duplicate search provider '${id}'.`)
  providers.set(id, provider)
}

export function clearSearchProviders(pluginId: string): void {
  for (const [id, provider] of providers) if (provider.pluginId === pluginId) providers.delete(id)
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

// Per hit rather than all-or-nothing, like a task-check concern: one unusable hit is dropped, not the
// group. A hit outside the scope it was given is dropped too, so a provider cannot leak another task's
// data into a page the caller scoped.
function sanitizeHits(value: unknown, scope: ReadonlySet<string>, limit: number): SearchHit[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): SearchHit[] => {
    if (!raw || typeof raw !== 'object') return []
    const hit = raw as Record<string, unknown>
    const title = text(hit.title, TITLE_MAX)
    const taskId = typeof hit.taskId === 'string' ? hit.taskId : null
    if (!title || (taskId !== null && !scope.has(taskId))) return []
    const target = hit.target as Record<string, unknown> | undefined
    const validTarget = target && typeof target.kind === 'string' && typeof target.resourceId === 'string'
      ? {
          kind: target.kind,
          resourceId: target.resourceId,
          ...(typeof target.subresourceId === 'string' ? { subresourceId: target.subresourceId } : {}),
        }
      : undefined
    return [{ taskId, title, preview: text(hit.preview, PREVIEW_MAX), ...(validTarget ? { target: validTarget } : {}) }]
  }).slice(0, limit)
}

// Raced rather than only aborted, for the reason taskChecks.ts gives: a provider that ignores its
// signal would otherwise hold the whole answer open.
function runOne(provider: RegisteredSearchProvider, query: SearchQuery, scope: ReadonlySet<string>): Promise<SearchGroup> {
  const group = (status: SearchGroup['status'], hits: SearchHit[] = []): SearchGroup =>
    ({ providerId: key(provider), label: provider.label, status, hits })
  return new Promise<SearchGroup>((resolve) => {
    const controller = new AbortController()
    let settled = false
    const finish = (answer: SearchGroup): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(answer)
    }
    const timer = setTimeout(() => {
      controller.abort()
      log.warn(`${key(provider)} did not answer within ${SEARCH_TIMEOUT_MS}ms`)
      finish(group('timeout'))
    }, SEARCH_TIMEOUT_MS)
    Promise.resolve()
      .then(() => provider.search(query, controller.signal))
      .then((hits) => finish(group('ok', sanitizeHits(hits, scope, query.limit))))
      .catch((error) => {
        log.warn(`${key(provider)} failed: ${describeError(error).message}`)
        finish(group('failed'))
      })
  })
}

/** Every provider's answer, in registry order. Never rejects. */
export async function searchProviders(query: SearchQuery): Promise<SearchGroup[]> {
  const bounded = { ...query, limit: Math.min(Math.max(query.limit, 1), SEARCH_HITS_MAX) }
  const scope = new Set(query.taskIds)
  const ordered = [...providers.values()].sort((a, b) => key(a).localeCompare(key(b)))
  return Promise.all(ordered.map((provider) => runOne(provider, bounded, scope)))
}
