// Central cache-policy TTLs (docs/caching.md). One greppable home for every serve-then-revalidate
// staleness window; the sync engine (server/sync/engine.ts) owns the *flow*, this owns the *numbers*.
// ponytail: values preserve the established per-route behavior. Tune them only as an explicit
// product/performance change, not incidentally while editing the engine.

export const PULLS_STALE_AFTER_MS = 45_000 // PR list + PR detail + PR files — "fast-changing"
export const REPOS_STALE_AFTER_MS = 300_000 // repo metadata — "slow-changing"
export const ROLLBAR_ITEMS_STALE_AFTER_MS = 120_000 // Rollbar items — errors move fast
export const LINEAR_ISSUES_STALE_AFTER_MS = 600_000 // Linear issues — tickets change slower than PRs

// After a rate-limited (429) background refresh, skip further *background* refreshes for that
// resource until the window passes — stale cache keeps serving instead of hammering a throttled
// upstream. Cold reads still try (there is nothing to serve otherwise).
// ponytail: fixed window, not Retry-After-aware; wire GitHub's header in if it proves tighter.
export const RATE_LIMIT_BACKOFF_MS = 60_000
