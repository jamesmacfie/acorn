# Phase 0 — Contract hygiene

**Status:** planned · **Depends on:** none · **Primary docs:** [review](../review.md)
§3, [inventories](../inventories.md) §2, [security](../security.md),
[testing](../testing.md) §2.

## Goal

Make the server-to-client contract enforceable before the route surface grows.
Phase 3 adds roughly 65 HTTP routes. Phase 4 projects tool declarations into
HTTP routes. If contract drift remains opt-in, those phases multiply the wrong
convention.

This phase changes enforcement, not product semantics:

- response objects are checked against shared types at construction sites;
- every error response uses one `ApiError` envelope;
- authenticated routes use one `requireUser` middleware instead of inline guards.

## Architectural Context

The current contract has three weak points:

- only a small subset of `c.json` response mappers use `satisfies`;
- approximately 191 error responses use several ad-hoc shapes;
- many routes repeat the same session guard.

The data flow after this phase is:

```text
route handler -> typed mapper satisfies shared response type -> c.json(response)
route error   -> respondError(c, status, code, detail?)        -> ApiError
protected app -> requireUser middleware                        -> handler
```

`/auth` and internal harness routes remain special: `/auth` never mounts under
`requireUser`; harness routes retain `INTERNAL_TOKEN` auth and only add user
identity where the specific route needs it.

## Implementation Plan

1. Add the shared contract.

   First home: `apps/desktop/src/shared/api.ts`.

   ```ts
   export type ApiError = {
     error: string
     detail?: string[]
   }
   ```

   Add a server helper near existing route utilities:
   `respondError(c, status, code, detail?)`.

2. Add `requireUser`.

   First home:
   `apps/desktop/src/server/middleware/requireUser.ts`.

   It rejects missing `c.get('user')` with `respondError(c, 401,
   'unauthenticated')` and otherwise allows the handler to rely on a user being
   present.

3. Sweep response mappers with `satisfies`.

   Work through [inventories](../inventories.md) §2c, highest-traffic first:
   `pulls.ts`, `prMirror.ts`, `me.ts`, `repoMirror.ts`, `rollbar.ts`,
   `linear.ts`, and `prCreate.ts`.

   Where a mapper already has a typed return, still use `satisfies` on the
   constructed object so adding a shared field fails at the mapper, not later.

4. Standardize the error envelope.

   Sweep [inventories](../inventories.md) §2b. Preserve machine-code semantics:
   `reauth`, `rate_limited`, `sso`, `node_id_unknown`,
   `validation_failed`, and provider reauth codes remain byte-identical error
   values.

   Specific mappings:

   - harness `kind` variants become `error` codes;
   - GitHub 422 prose in `prCreate.ts` moves to `detail`, while `error` becomes
     `validation_failed`;
   - `{ error, status }` bodies drop body-level `status`.

5. Replace inline session guards.

   Apply `requireUser` per protected router at mount time. Delete the inline
   `unauthenticated` returns. While touching route files, adopt
   `resolveRepoForUser` where routes hand-roll mirror repo lookup.

## Slice Order

1. Add `ApiError`, `respondError`, `requireUser`, and tests for one low-risk
   router.
2. Add the parameterized 401 helper over the protected router table.
3. Migrate high-traffic response mappers.
4. Sweep error envelopes.
5. Delete inline auth guards and update inventory rows.

## Acceptance Criteria

- Adding a required field to a shared response type fails `pnpm lint` in every
  mapper that omits it.
- All server error bodies conform to `ApiError`.
- No route file contains an inline `unauthenticated` response.
- `/auth` is still unauthenticated by construction.
- Harness/internal routes retain `INTERNAL_TOKEN` semantics.
- Meaningful machine error codes keep their existing spelling unless this phase
  explicitly names the mapping.

## Verification

- `pnpm lint`
- `pnpm test`
- New route tests for one migrated router proving:
  - successful typed response;
  - `ApiError` response shape;
  - protected-route 401 behavior.
- Parameterized 401 test over the protected router table.
- Targeted route tests for `prActions`, `prCreate`, and `harness` as required by
  [testing](../testing.md) §2.

## References

- [review.md](../review.md) recommendation #1 and #6.
- [inventories.md](../inventories.md) §2a, §2b, §2c.
- [security.md](../security.md) §2 and §7.
- [feature-parity.md](../feature-parity.md) §16.
- [docs-overhaul.md](../docs-overhaul.md) §2 for `docs/api-reference.md`.
