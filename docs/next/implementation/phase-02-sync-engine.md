# Phase 2 — Sync engine

**Status:** planned · **Depends on:** none · **Primary docs:**
[review](../review.md) §1c, [contribution-points](../contribution-points.md)
§4.9, [inventories](../inventories.md) §2d.

## Goal

Extract the serve-then-revalidate state machine from copied route logic into a
single sync engine and cache policy. This is the highest-leverage server
refactor before providers become descriptor-driven.

## Architectural Context

The app currently repeats a four-branch cache flow in GitHub routes and provider
routes:

- fresh cache: serve;
- stale cache: serve and refresh in the background;
- cold cache: block on refresh;
- upstream 304/backoff: preserve usable cache and policy state.

Copies diverge on cold detection, TTL constants, and ETag handling. The engine
must own flow, in-flight dedupe, TTL decisions, 304 handling, and backoff. It
must not assume the resource key is repo-scoped.

## Implementation Plan

1. Add `server/sync/engine.ts`.

   Shape:

   ```ts
   serveThenRevalidate<T>(c, {
     resource: string
     ttlMs: number
     etag?: boolean
     read: () => Promise<T | null>
     refresh: (prior: SyncState | null) => Promise<void>
   }): Promise<T>
   ```

   The engine owns:

   - fresh/stale/cold/not-modified branching;
   - `sync_state` bookkeeping when a caller uses it;
   - in-flight refresh dedupe;
   - rate-limit backoff;
   - `read() === null` as the single cold-cache idiom.

2. Add `server/sync/policy.ts`.

   Move all TTL constants from [inventories](../inventories.md) §2d into one
   greppable policy module. Do not tune values in this phase.

3. Extract and test the pure decision function.

   Unit-test fresh, stale, cold, 304, backoff, and concurrent stale hits before
   moving route behavior.

4. Port GitHub routes.

   Port `pulls.ts`, `pullDetail.ts`, `pullFiles.ts`, `repos.ts`, and
   `pullsBatch.ts`. Add ETag revalidation to the repos list while porting.

5. Port Linear and Rollbar through descriptors where possible.

   Their freshness is per item (`issues.fetchedAt`), not necessarily
   `sync_state`. The engine owns flow, not the bookkeeping store. Do not force
   them onto `sync_state` in this phase.

## Slice Order

1. Decision function and tests.
2. Engine wrapper and policy module.
3. One GitHub route.
4. Remaining GitHub routes.
5. Provider variants.
6. Inventory and docs updates.

## Acceptance Criteria

- No route hand-implements serve-then-revalidate.
- TTLs are centralized in `server/sync/policy.ts`.
- Cold detection is consistently `read() === null`.
- Two stale hits for the same resource do not fire two refreshes.
- Repos list gets ETag revalidation.
- Atomic mirror writes remain atomic inside `refresh`; the engine does not
  split delete/insert batches.
- Resource keys remain opaque and caller-defined.

## Verification

- `pnpm lint`
- `pnpm test`
- Engine unit tests for all branches plus 304, backoff, and in-flight dedupe.
- Existing route tests stay green.
- Manual stale-cache pass: PR list, PR detail, PR files, and repos serve stale
  data then update after refresh.

## References

- [review.md](../review.md) §1c and recommendation #2.
- [contribution-points.md](../contribution-points.md) §4.9.
- [inventories.md](../inventories.md) §2d.
- [performance.md](../performance.md) §3.
- [docs-overhaul.md](../docs-overhaul.md) §2 for `docs/caching.md`,
  `docs/data-layer.md`, and `docs/github-integration.md`.
