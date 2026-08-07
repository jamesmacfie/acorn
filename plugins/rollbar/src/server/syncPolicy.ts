// How fast rollbar's mirrored items go stale. Moved out of @acorn/node-core/server/sync/policy.ts
// (finding 8): errors move fast, and that is a fact about Rollbar rather than about the sync engine.
export const ROLLBAR_ITEMS_STALE_AFTER_MS = 120_000
