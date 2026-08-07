# WP-11 — Scoped validation hardening

**Effort:** S–M · **Depends on:** nothing. Coordinate with WP-10 Group C (both touch
`plugins/agents/src/main/webhookService.ts`).

## Context

The stated contract (`docs/architecture-overview.md` § Wire validation) is: Zod `safeParse`
against a module-level schema at every **mutation** boundary, 400 on failure; reads deliberately
unvalidated. The model implementation is `packages/node-core/src/server/routes/worktree.ts`.

Frozen counts ([BASELINE.md](BASELINE.md)): 130 `.parse(`, 76 `.safeParse(`, 86 raw `JSON.parse`
in non-test files. The raw `JSON.parse` sites are the audit surface — but **triage before
touching**: an early audit assumed `webhookService.ts`'s parses were external input; verification
showed they parse the plugin's *own DB rows* (`JSON.parse(row.eventsJson)` at `:62` and `:287`,
cast to a type). Own-DB JSON is the lowest-risk class. The classes, in descending priority:

1. **External input** (webhook request bodies, provider responses feeding mutations, agent-emitted
   frames) — must have schemas per the contract.
2. **Persisted client/user data** (prefs, localStorage-like stores, imported files) — cheap
   corruption shield; e.g. `plugins/docker/src/client/dockerPrefs.ts:18` spreads
   `JSON.parse(raw) as Partial<DockerPrefs>` over defaults — a malformed stored value walks
   straight in. Note repo precedent: persisted-state slices already have codecs and a conformance
   test (`apps/desktop/test/integration/persistedState.conformance.test.ts`) — prefer routing
   persistence through that mechanism over ad-hoc schemas where it fits.
3. **Own-DB / internal round-trips** — out of scope; a cast is acceptable where the same module
   wrote the JSON.

## Pre-flight

```sh
grep -rn 'JSON\.parse' packages plugins apps --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
# the mutation-boundary model:
sed -n '1,40p' packages/node-core/src/server/routes/worktree.ts
```

## End state

- A committed triage table (appended to this doc): every non-test `JSON.parse` site classified
  external / persisted / internal, with the fix applied for classes 1–2 and a one-word
  justification for each class-3 site left alone.
- Every class-1 site parses through a module-level Zod schema with the same failure semantics as
  the surrounding code's contract (routes: 400 envelope; background services: reject-and-log via
  the existing error path — never a new logging mechanism).
- Class-2 sites fall back to defaults on schema failure instead of spreading corrupt data.

## Non-goals

- Converting the 130 `.parse(` calls to `safeParse` wholesale — many are internal invariants
  where throwing is correct. Only sites that sit on inbound external paths and currently `throw`
  where the contract says 400 are in scope; spot-check the route files
  (`grep -rn '\.parse(' packages/node-core/src/server/routes plugins/*/src/server/routes | grep -v '\.test\.'`)
  and fix only genuine contract violations.
- Read-path/response validation (deliberately out per contract).
- Own-DB parse sites (class 3).
- New validation libraries — zod is the catalog-pinned standard.

## Slices (one commit each)

1. **Triage.** Classify all 86 sites; append the table here. No code change.
2. **Class-1 fixes**, grouped by package (likely candidates from the audit: agent webhook request
   handling — the *inbound* payload path in `webhookService.ts`, distinct from the own-DB row
   parses; agent driver frames in `plugins/agents/src/main/drivers/`; check
   `plugins/http/src/shared/model.ts`). One package per commit.
3. **Class-2 fixes:** `dockerPrefs.ts` (schema-or-defaults), `plugins/memory/src/main/
   memoryProposals.ts` if triage classifies it persisted, and any other persisted-prefs site.
4. **Route `.parse` spot-check** (from Non-goals paragraph): fix genuine mutation-boundary
   contract violations only; record "none found" if none.

## Gates

Per slice: touched package's vitest + `pnpm lint`. WP-02 slice 3 (docker parse/prefs tests)
before this package's slice 3 makes the prefs change provable — run in that order if both
packages are in flight.

## Risks & rollback

- **Overzealous schemas break working flows**: a schema stricter than reality rejects payloads the
  old cast accepted. Schemas must be derived from what the code *consumes* (fields actually read),
  not from what a doc says the payload contains — especially rollbar/linear, whose shapes came
  from docs, not live payloads (repo memory).
- Class-2 default-fallback changes user-visible behavior only when data was already corrupt —
  acceptable, but log the fallback so corruption is visible.
- Per-package commits revert independently.

## Doc updates

`docs/architecture-overview.md` § Wire validation only if the contract's edge cases get sharpened
(e.g. "background services reject-and-log"); otherwise none.

## Done criteria

- [ ] Triage table appended, all 86 sites classified.
- [ ] Class-1 sites schema-validated; class-2 sites default-on-failure.
- [ ] Route spot-check recorded.
- [ ] BASELINE counts re-measured and recorded.

## Progress

- [ ] Slice 1 — triage table
- [ ] Slice 2 — class-1 fixes
- [ ] Slice 3 — class-2 fixes
- [ ] Slice 4 — route spot-check
