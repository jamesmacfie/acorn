import { trackBackgroundRefresh } from '../background'
import { RATE_LIMIT_BACKOFF_MS } from './policy'

export type RouteFailure = { error: string; status: 401 | 403 | 404 | 429 | 502; detail?: string[] }
export type RouteResult<T> = { ok: true; value: T } | { ok: false; failure: RouteFailure }

// A refresh reports success or a typed failure but produces no value. The engine re-reads the
// mirror after a cold refresh, so there is nothing for `refresh` to return.
export type RefreshResult = { ok: true } | { ok: false; failure: RouteFailure }

// What `read` returns: the cached data plus when it was last refreshed. `null` is the single
// cold-cache idiom: it means "this resource was never fetched", not "the data is empty". A fetched
// resource with no rows returns `{ data: [], fetchedAt }` so it serves as fresh/stale, never cold.
export type Cached<T> = { data: T; fetchedAt: number }

export type SyncDecision = 'fresh' | 'stale' | 'cold'

// The pure decision. `cold` when nothing was ever fetched; `fresh` inside the TTL; `stale` past it.
// Force (bypass cache) is a wrapper concern, not a cache-state fact. Kept out of here so this stays
// a pure function of the cache state and is trivially testable.
export const decideSync = (o: { cached: boolean; fetchedAt: number | null; ttlMs: number; now: number }): SyncDecision => {
  if (!o.cached) return 'cold'
  if (o.fetchedAt != null && o.fetchedAt + o.ttlMs > o.now) return 'fresh'
  return 'stale'
}

// In-flight refresh dedupe, keyed by (userId, resource): two stale hits for the same user's
// resource join one refresh instead of firing two. The key carries the userId because refreshes
// write user-scoped mirror rows with the caller's token, so joining another user's refresh would
// leave this user's mirror unwritten (and share rate-limit fate across accounts).
// The entry clears when the refresh settles.
const inFlight = new Map<string, Promise<RefreshResult>>()

const dedupe = (key: string, refresh: () => Promise<RefreshResult>): Promise<RefreshResult> => {
  const existing = inFlight.get(key)
  if (existing) return existing
  const p = refresh().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

const backoffUntil = new Map<string, number>()

const scheduleBackgroundRefresh = (key: string, refresh: () => Promise<RefreshResult>, backoffMs: number): void => {
  if (Date.now() < (backoffUntil.get(key) ?? 0)) return // backed off — keep serving stale, skip the doomed call
  trackBackgroundRefresh(
    key,
    dedupe(key, refresh).then((r) => {
      if (!r.ok && r.failure.status === 429) backoffUntil.set(key, Date.now() + backoffMs)
    }),
  )
}

// Serve-then-revalidate (docs/caching.md § Provider mirrors). Returns a RouteResult so the route
// maps failures through respondError with the right status: a successful serve (fresh, stale, or
// post-cold-refresh) is `{ ok: true, value }`.
export async function serveThenRevalidate<T>(opts: {
  resource: string // opaque, caller-defined
  userId: string // scopes the in-flight dedupe / backoff key — mirrors are per-user, so flow state must be too
  ttlMs: number
  backoffMs?: number
  force?: boolean // bypass cache and block on a fresh refresh (e.g. ?force=true)
  read: () => Promise<Cached<T> | null>
  refresh: () => Promise<RefreshResult>
}): Promise<RouteResult<T>> {
  const key = `${opts.userId}:${opts.resource}`
  const cached = await opts.read()
  const decision = opts.force ? 'cold' : decideSync({ cached: cached != null, fetchedAt: cached?.fetchedAt ?? null, ttlMs: opts.ttlMs, now: Date.now() })

  // Fresh, or stale: serve the cache. Stale also kicks a background revalidate (deduped, backoff-aware).
  if (cached && decision !== 'cold') {
    if (decision === 'stale') scheduleBackgroundRefresh(key, opts.refresh, opts.backoffMs ?? RATE_LIMIT_BACKOFF_MS)
    return { ok: true, value: cached.data }
  }

  // Cold: block on a real refresh. Forced skips the dedupe, since joining a refresh that started
  // before the user's action would serve pre-force data and break the "force means fresh" guarantee.
  const result = opts.force ? await opts.refresh() : await dedupe(key, opts.refresh)
  if (!result.ok) return result
  const after = await opts.read()
  // Unreachable in practice: refresh writes the freshness marker before returning ok, so a
  // subsequent read is non-null. Guarded so a broken refresh surfaces as an error, not `undefined`.
  if (!after) return { ok: false, failure: { error: 'sync_empty', status: 502 } }
  return { ok: true, value: after.data }
}
