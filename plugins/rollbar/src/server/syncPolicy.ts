// How fast Rollbar's mirrored items go stale. See docs/caching.md for why this constant lives
// here and not in the sync engine's own policy.
export const ROLLBAR_ITEMS_STALE_AFTER_MS = 120_000
