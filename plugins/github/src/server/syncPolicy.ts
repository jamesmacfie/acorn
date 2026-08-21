// How fast github's mirrored data goes stale, moved out of the sync engine's own policy because how
// fast a provider's data moves is a fact about that provider, not about core (docs/caching.md).
// A PR's list, detail and file set change while someone is reviewing; repo metadata does not.
export const PULLS_STALE_AFTER_MS = 45_000
export const REPOS_STALE_AFTER_MS = 300_000
