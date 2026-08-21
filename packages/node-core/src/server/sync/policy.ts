// The sync engine's own policy: the rate-limit backoff (docs/caching.md § Provider mirrors). Per-
// provider staleness TTLs live with each provider's own plugin instead.
export const RATE_LIMIT_BACKOFF_MS = 60_000
