// How fast linear's mirrored issues go stale (docs/caching.md § Provider mirrors). Tickets change more
// slowly than pull requests, which is a judgement about Linear.
//
// Nothing reads it yet: linear's routes go through the provider's own fetch path rather than the
// engine's read(). Kept as the declared policy for the day they do.
export const LINEAR_ISSUES_STALE_AFTER_MS = 600_000
