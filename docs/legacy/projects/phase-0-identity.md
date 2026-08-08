# Phase 0 — Identity decouple (SHIPPED; completed record)

**Status: shipped**, uncommitted on `james/vnext-fable`. This file is the as-built record: what
changed, why, and what a later phase may still touch.

## Problem

`userId` — the scope key for `prefs`, `integrations`, `issues`, `issue_resources`, `sync_state` —
was the authenticated GitHub login, and the ONLY writer of the machine identity binding
(`ACTIVE_IDENTITY`) was the GitHub device-auth route
(`plugins/github/src/server/routes/deviceAuth.ts`, which called `core.identity.bind(...)` after
`connectProvider`). Consequences:

- The **internal principal** (MCP server, agents, PTY children presenting `x-acorn-internal`
  tokens) **failed closed** with no bound identity
  (`packages/node-core/src/server/middleware/auth.ts`, `internalPrincipal`). A fresh install
  could not run a managed agent until GitHub was connected once.
- The **device principal** fell back to `userId: ''`, so a pre-GitHub install silently wrote
  user-scoped rows under the empty string.
- `IdentityService.sole()` existed to guess "the one identity" from prefs rows plus GitHub's
  mirror (`repoMirrorSource().identities()`), used by plugins/http to claim legacy unscoped rows.

## What shipped

### Boot-minted opaque owner id

`ensureBoundIdentity(db, store)` in
`packages/node-core/src/main/core/identity/identity.ts`:

- If nothing is bound, mint `owner-<uuid>` and persist it via the existing
  `ActiveIdentityStore` (the `active-identity` file in the data root, 0600, atomic write).
- Then adopt any `''`-scoped rows into the bound owner across the five user-scoped core tables,
  with `UPDATE OR IGNORE … SET user_id = <owner> WHERE user_id = ''` followed by
  `DELETE … WHERE user_id = ''` per table (the owner's existing row wins a PK conflict; the ''
  remnant is dropped, not merged).
- Called synchronously from `makeBindings` (`packages/node-core/src/main/bindings.ts`) right
  where the store is constructed — every real boot passes through it.

**Existing installs need zero data rewrite**: a previously-bound GitHub login simply IS that
node's opaque owner id forever. The semantics changed ("opaque id", not "GitHub login"); the
stored value did not.

### Providers never bind

- The `core.identity.bind(integration.label)` call was removed from the device-auth poll route.
  The GitHub login now lives only in the integration row's `account` metadata.
- `IdentityService` shrank to `{ active(): string | null }`. `bind`/`unbind`/`sole` are gone;
  `createIdentityService(store)` no longer takes a DB handle.
- `RepoMirrorSource.identities()` was deleted from the slot type
  (`packages/node-core/src/server/repoMirror.ts`), from github's slot filler
  (`plugins/github/src/node/index.ts`), and its query (`mirroredIdentities`) from
  `plugins/github/src/server/mirrorQueries.ts`.
- `plugins/http/src/server/storage.ts` (`protectLegacyHttpStorage`) claims legacy
  `__legacy_unscoped__` rows for `identity.active()` — the boot-bound owner — instead of the
  deleted `sole()` heuristic. The plugin's `ready`-vs-`init` ordering comment was updated: the
  ordering constraint no longer exists, but `ready` still runs before the listener binds, so it
  was left where it is.

### What deliberately did NOT change

- The **fail-closed null** in `internalPrincipal` stays. After first boot it is unreachable in
  production; it still fires for a bare test `Env` built without `ensureBoundIdentity`, which is
  the correct posture for a hand-rolled context.
- The `?? ''` fallback in `devicePrincipal` stays for the same test-only reason.
- The boundaries rule "only core reaches the machine identity store"
  (`tools/arch/boundaries.test.ts`) still passes unchanged — the allowlist was already
  node-core + apps/node.
- Avatars: `githubAvatarUrl` in `packages/client-core/src/ui/displayMeta.ts` is only used for PR
  authors/reviewers (real GitHub logins), and `AccountMenu` displays no identity at all, so no
  client change was needed. If a future surface ever displays the machine identity, do NOT render
  `owner-<uuid>` raw.

## Files touched

```
packages/node-core/src/main/core/identity/identity.ts   (rewritten: active() + ensureBoundIdentity)
packages/node-core/src/main/core/index.ts               (CoreServices wiring + comment)
packages/node-core/src/main/bindings.ts                 (boot call + ACTIVE_IDENTITY comment)
packages/node-core/src/main/activeIdentity.ts           (comment only)
packages/node-core/src/server/middleware/auth.ts        (comments only — behavior unchanged)
packages/node-core/src/server/repoMirror.ts             (identities() removed)
packages/node-core/src/server/db/schema.ts              (user_id comments)
plugins/github/src/server/routes/deviceAuth.ts          (bind removed; factory takes no args now)
plugins/github/src/node/index.ts                        (slot filler, imports)
plugins/github/src/server/mirrorQueries.ts              (mirroredIdentities deleted)
plugins/http/src/node/index.ts                          (comment)
plugins/http/src/server/storage.ts                      (sole() → active())
docs/authentication.md                                  (userId section rewritten)
```

Tests updated/added:

```
packages/node-core/src/main/core/identity.test.ts       (rewritten for ensureBoundIdentity:
                                                          mint, keep-legacy-login, '' adoption,
                                                          PK-conflict remnant drop, idempotence)
plugins/github/src/server/routes/deviceAuth.test.ts     (no core arg; bind assertion removed)
plugins/http/src/server/storage.test.ts                 (identity stub is { active } now)

Completion audit follow-ups:

- `apps/node/src/service/runtime.test.ts` now asserts that a real fresh no-GitHub boot persists the
  `owner-<uuid>` identity file through the composition root, not only through the pure identity helper.
- Live ownership/security docs (`docs/data-layer.md`, `docs/github-integration.md`, `docs/integrations.md`,
  and `docs/security.md`) now describe the boot-bound owner rather than an active GitHub login.
- Stale provider/boundary comments and HTTP test naming were aligned with the read-only identity seam.
```

## Verification

```sh
pnpm rebuild:node                       # better-sqlite3 ABI for plain-Node vitest
pnpm --filter @acorn/node-core exec vitest run src/main/core/identity.test.ts \
  src/server/middleware/auth.test.ts src/main/activeIdentity.test.ts
pnpm --filter @acorn/plugin-github exec vitest run src/server/routes/deviceAuth.test.ts
pnpm --filter @acorn/plugin-http exec vitest run src/server/storage.test.ts
pnpm --filter @acorn/node exec vitest run test/integration/internalPrincipal.test.ts
pnpm --filter @acorn/arch-tests test    # boundaries
pnpm lint
```

All green as of shipping. Manual check worth doing when a runnable checkout is available: fresh
data root, never connect GitHub, open a task and start a managed agent session — it must
authenticate (previously it could not).

## Notes for later phases

- Phase 2's `base_ref:<owner>/<repo>` pref rekey (to `base_ref:<projectId>`) operates on rows
  scoped by this owner id — the rekey must preserve the `user_id` column untouched.
- If multi-GitHub-account support is ever built, it is **multiple integration rows under the one
  owner id**, not multiple identities. One owner per node is now a stated invariant
  (docs/authentication.md).
