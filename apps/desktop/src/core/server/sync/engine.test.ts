import { describe, expect, it, vi } from 'vitest'
import { settleBackground } from '../background'
import { RATE_LIMIT_BACKOFF_MS } from './policy'
import { type Cached, type RefreshResult, decideSync, serveThenRevalidate } from './engine'

const TTL = 1000

describe('decideSync (pure)', () => {
  const base = { ttlMs: TTL, now: 10_000 }

  it('cold when nothing was ever fetched', () => {
    expect(decideSync({ ...base, cached: false, fetchedAt: null })).toBe('cold')
  })

  it('fresh inside the TTL', () => {
    expect(decideSync({ ...base, cached: true, fetchedAt: 10_000 - TTL + 1 })).toBe('fresh')
  })

  it('stale past the TTL', () => {
    expect(decideSync({ ...base, cached: true, fetchedAt: 10_000 - TTL - 1 })).toBe('stale')
  })

  it('stale when cached but freshness is unknown (no fetchedAt)', () => {
    expect(decideSync({ ...base, cached: true, fetchedAt: null })).toBe('stale')
  })
})

// A tiny in-memory resource: read serves `cached`, refresh flips it to fresh (or fails).
const makeResource = (initial: Cached<string> | null, refreshResult: RefreshResult = { ok: true }) => {
  let cached = initial
  const refresh = vi.fn(async (): Promise<RefreshResult> => {
    if (refreshResult.ok) cached = { data: 'fresh', fetchedAt: Date.now() }
    return refreshResult
  })
  return { read: async () => cached, refresh }
}

describe('serveThenRevalidate', () => {
  it('fresh: serves the cache without refreshing', async () => {
    const r = makeResource({ data: 'cached', fetchedAt: Date.now() })
    const result = await serveThenRevalidate({ resource: 'st-fresh', userId: 'u1', ttlMs: TTL, read: r.read, refresh: r.refresh })
    expect(result).toEqual({ ok: true, value: 'cached' })
    expect(r.refresh).not.toHaveBeenCalled()
  })

  it('stale: serves the cache immediately and revalidates in the background', async () => {
    const r = makeResource({ data: 'stale', fetchedAt: Date.now() - TTL - 1 })
    const result = await serveThenRevalidate({ resource: 'st-stale', userId: 'u1', ttlMs: TTL, read: r.read, refresh: r.refresh })
    expect(result).toEqual({ ok: true, value: 'stale' })
    await settleBackground()
    expect(r.refresh).toHaveBeenCalledTimes(1)
  })

  it('cold: blocks on a refresh, then serves the freshly-mirrored read', async () => {
    const r = makeResource(null)
    const result = await serveThenRevalidate({ resource: 'st-cold', userId: 'u1', ttlMs: TTL, read: r.read, refresh: r.refresh })
    expect(result).toEqual({ ok: true, value: 'fresh' })
    expect(r.refresh).toHaveBeenCalledTimes(1)
  })

  it('cold refresh failure propagates the RouteFailure', async () => {
    const failure = { ok: false, failure: { error: 'reauth', status: 401 } } as const
    const r = makeResource(null, failure)
    const result = await serveThenRevalidate({ resource: 'st-cold-fail', userId: 'u1', ttlMs: TTL, read: r.read, refresh: r.refresh })
    expect(result).toEqual(failure)
  })

  it('force: blocks on a refresh even when the cache is fresh', async () => {
    const r = makeResource({ data: 'cached', fetchedAt: Date.now() })
    const result = await serveThenRevalidate({ resource: 'st-force', userId: 'u1', ttlMs: TTL, force: true, read: r.read, refresh: r.refresh })
    expect(result).toEqual({ ok: true, value: 'fresh' })
    expect(r.refresh).toHaveBeenCalledTimes(1)
  })

  it('two concurrent stale hits fire only one refresh (in-flight dedupe)', async () => {
    // A refresh that only completes when we release it, so both stale hits overlap in-flight.
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const refresh = vi.fn(async (): Promise<RefreshResult> => {
      await gate
      return { ok: true }
    })
    const read = async () => ({ data: 'stale', fetchedAt: Date.now() - TTL - 1 })
    const opts = { resource: 'st-dedupe', userId: 'u1', ttlMs: TTL, read, refresh }

    const [a, b] = await Promise.all([serveThenRevalidate(opts), serveThenRevalidate(opts)])
    expect(a).toEqual({ ok: true, value: 'stale' })
    expect(b).toEqual({ ok: true, value: 'stale' })

    release()
    await settleBackground()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('in-flight dedupe is scoped per user: the same resource for two users fires two refreshes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slowRefresh = () =>
      vi.fn(async (): Promise<RefreshResult> => {
        await gate
        return { ok: true }
      })
    const refreshA = slowRefresh()
    const refreshB = slowRefresh()
    const read = async () => ({ data: 'stale', fetchedAt: Date.now() - TTL - 1 })

    await Promise.all([
      serveThenRevalidate({ resource: 'st-user-scope', userId: 'u1', ttlMs: TTL, read, refresh: refreshA }),
      serveThenRevalidate({ resource: 'st-user-scope', userId: 'u2', ttlMs: TTL, read, refresh: refreshB }),
    ])
    release()
    await settleBackground()
    expect(refreshA).toHaveBeenCalledTimes(1)
    expect(refreshB).toHaveBeenCalledTimes(1) // u2 did not join u1's refresh
  })

  it('force: runs its own refresh instead of joining an in-flight background refresh', async () => {
    // A stale hit arms a background refresh that never settles within the test window…
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const backgroundRefresh = vi.fn(async (): Promise<RefreshResult> => {
      await gate
      return { ok: true }
    })
    const read = async () => ({ data: 'stale', fetchedAt: Date.now() - TTL - 1 })
    await serveThenRevalidate({ resource: 'st-force-own', userId: 'u1', ttlMs: TTL, read, refresh: backgroundRefresh })

    // …and a forced request while it is in-flight must still perform its own fetch.
    const forcedRefresh = vi.fn(async (): Promise<RefreshResult> => ({ ok: true }))
    const result = await serveThenRevalidate({ resource: 'st-force-own', userId: 'u1', ttlMs: TTL, force: true, read, refresh: forcedRefresh })
    expect(result).toEqual({ ok: true, value: 'stale' })
    expect(forcedRefresh).toHaveBeenCalledTimes(1)

    release()
    await settleBackground()
  })

  it('rate-limit backoff: a 429 background refresh suppresses the next background refresh', async () => {
    const resource = 'st-backoff'
    const refresh = vi.fn(async (): Promise<RefreshResult> => ({ ok: false, failure: { error: 'rate_limited', status: 429 } }))
    const read = async () => ({ data: 'stale', fetchedAt: Date.now() - TTL - 1 })

    await serveThenRevalidate({ resource, userId: 'u1', ttlMs: TTL, read, refresh })
    await settleBackground()
    expect(refresh).toHaveBeenCalledTimes(1) // this call 429'd → backoff armed

    await serveThenRevalidate({ resource, userId: 'u1', ttlMs: TTL, read, refresh })
    await settleBackground()
    expect(refresh).toHaveBeenCalledTimes(1) // still 1: the second stale hit skipped the refresh

    // Sanity: the backoff window is the policy constant, not permanent.
    expect(RATE_LIMIT_BACKOFF_MS).toBeGreaterThan(0)
  })
})
