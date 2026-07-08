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

## Required Context

Read these sections before implementation. They are the contract this phase is
making enforceable:

- [review.md](../review.md) §3 explains why the current route contract is too
  easy to bypass; §6 explains why tests must move closer to route risk.
- [inventories.md](../inventories.md) §2a lists auth-guard targets, §2b lists
  error-shape drift, and §2c lists mapper sites that lack `satisfies`.
- [feature-parity.md](../feature-parity.md) §16 defines auth and error
  vocabulary parity. Preserve user-visible and machine-readable error behavior
  unless this phase names a mapping explicitly.
- [security.md](../security.md) §2 lists invariants that must survive every
  phase; §7 names verification expectations for route boundaries.
- [testing.md](../testing.md) §2 describes how route tests should scale with
  risk, including auth, malformed body, and boundary behavior.
- [docs-overhaul.md](../docs-overhaul.md) §1 and §2 require docs updates in the
  same PR when API, auth, or error facts change.

The important boundary is server construction, not client interpretation.
Handlers may keep domain-specific logic, but response construction, auth
absence, and error envelope shape must become shared conventions.

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

## Design Guardrails

- **Extensibility:** new route modules should get auth and error behavior by
  mounting under the protected app or using the shared helper, not by copying a
  local idiom.
- **Simplicity:** do not introduce a route framework or generated API layer in
  this phase. The win is mandatory local typing plus one error helper.
- **Robustness:** preserve machine-code spelling for provider/auth flows so
  existing client branches and tests continue to describe real behavior.
- **Maintainability:** every exception must be named. `/auth` and harness auth
  are allowed exceptions; ad-hoc route-level unauthenticated bodies are not.
- **External-control forward-compatibility:** write the guard to resolve a
  `Principal` (a `kind`, a capability set, and the GitHub-token posture) from
  whichever credential is present — the cookie (`user`) and `INTERNAL_TOKEN`
  (internal) are the two kinds today — and have routes gate on the principal,
  not on "a cookie is present." This adds no work now (the guard already handles
  two credential types) but keeps a future authorized external principal a new
  `kind`, not a re-touch of every migrated route. Rationale and the other four
  seams: [security.md](../security.md) §9.

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
- Every route response mapper listed in [inventories](../inventories.md) §2c is
  either migrated or has an explicit follow-up entry with owner and reason.
- All server error bodies conform to `ApiError`.
- Error bodies never include a second shape such as `{ kind }`, body-level
  `status`, provider-specific object envelopes, or prose-only `error` values
  where a machine code is required.
- No route file contains an inline `unauthenticated` response.
- `/auth` is still unauthenticated by construction.
- Harness/internal routes retain `INTERNAL_TOKEN` semantics.
- Meaningful machine error codes keep their existing spelling unless this phase
  explicitly names the mapping.
- Protected-router mounting order is documented in code or tests so future
  routes cannot accidentally mount outside `requireUser`.
- API docs that describe error envelopes, auth, or response typing are updated
  in the same PR according to [docs-overhaul.md](../docs-overhaul.md) §2.

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
- [security.md](../security.md) §2, §7, and §9.
- [feature-parity.md](../feature-parity.md) §16.
- [docs-overhaul.md](../docs-overhaul.md) §2 for `docs/api-reference.md`.
