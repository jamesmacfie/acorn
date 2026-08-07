// How fast linear's mirrored issues go stale. Moved out of @acorn/node-core/server/sync/policy.ts
// (finding 8). Tickets change more slowly than pull requests, which is a judgement about Linear.
//
// Nothing reads it yet — linear's routes go through the provider's own fetch path rather than the
// engine's read(). Kept rather than deleted because it is the declared policy for the day they do, and
// because deleting it would look like a decision that Linear needs no TTL.
export const LINEAR_ISSUES_STALE_AFTER_MS = 600_000
