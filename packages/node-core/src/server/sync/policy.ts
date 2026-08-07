// The sync engine's own policy. What is NOT here any more is the per-provider staleness TTLs.
//
// This file listed four of them — github's pulls and repos, rollbar's items, linear's issues — so core
// decided how fast each provider's data goes stale, for providers it otherwise knows nothing about.
// Each now sits with the plugin whose API it describes, because "how fast do Rollbar items move" is a
// fact about Rollbar (finding 8).
//
// The backoff stays: it is the ENGINE's, not a provider's. It is how long a rate-limited key waits
// before another background refresh is scheduled, and a provider that could set its own would only be
// able to make the node hammer an API that has already said no. `read()` still takes a per-call
// `backoffMs` override for a provider that publishes a Retry-After.
export const RATE_LIMIT_BACKOFF_MS = 60_000
