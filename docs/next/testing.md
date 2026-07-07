# Testing strategy — what gates what, and what each suite proves

**Status:** plan · **Date:** 2026-07-07 · **Companions:**
[implementation.md](./implementation.md) (ongoing tracks + phase gates),
[review.md](./review.md) §6, [inventories.md](./inventories.md) §2e

review.md's finding stands: coverage is excellent where code is pure (~40 test
files) and absent where the risk is (18 of 26 route files untested, zero
main-process wiring tests, zero component tests). The phases about to rebuild
boot, transport, and restore make that gap acute — Phase 6's known failure mode
is a *race*, which a manual relaunch check won't catch. This doc specifies the
three suites, in priority order, and the discipline that keeps them cheap.

The posture stays lazy on purpose: no coverage targets, no test pyramid
doctrine, no component-test mandate. Each suite below exists because a specific
phase cannot verify its done-criterion without it.

---

## 1. The Playwright Electron smoke suite (the gate — build first)

**Gates Phases 3, 5, and 6.** It must land and pass on `main` *before Phase 3
starts*; those phases' "verify" steps run it before/after.

One new dev-dependency (`@playwright/test` with the Electron driver — the only
new test tech this plan admits), one spec file, **five tests**:

| # | Test | Asserts | Catches |
| --- | --- | --- | --- |
| S1 | boot | app launches, window appears, shell paints, zero uncaught exceptions / console errors on boot | composition-root regressions (Phase 1) |
| S2 | restore | relaunch after use restores last workspace, task, source, pane layout (set, order, id-keyed weights, pins — maximize deliberately not restored), and editor tabs | the restore-pipeline race class (Phase 6) |
| S3 | open task | create/open a task, switch panes via chords, pane body renders; once ux §7 lands: resize a divider, pin + show, maximize toggle | pane-registry and pane-management regressions (Phase 5) |
| S4 | terminal echo | open a terminal, type a command, output appears; typed chars echo | transport regressions (Phase 3 — IPC→WS) |
| S5 | quit clean | quit; process exits without hanging, teardown log line present, no orphaned PTY | lifecycle/teardown (Phase 1) |

Implementation notes:

- Fixture: a temp `userData` dir per run (fresh SQLite, no real login). The
  auth gate needs a test seam — either a seeded session cookie (mint one with
  a known `SESSION_ENC_KEY`, the cheap option since `session.ts` is pure and
  already tested) or a `ACORN_TEST_SESSION` env the auth middleware honors
  only when `NODE_ENV=test`. Decide once, in the suite's first PR.
- S2 is the valuable one and the reason the suite exists. It runs the app
  *twice* in one test (launch → interact → quit → relaunch → assert). Build it
  even if it's the slowest.
- No GitHub network: the suite exercises shell/terminal/restore paths that
  don't need PR data. Do not mock the GitHub API for the smoke suite — tasks
  and terminals work without it. (Route tests cover the GitHub paths with
  fetch stubs, §2.)
- Runs locally via `pnpm test:e2e`; keep it under ~2 minutes total so it's
  actually run. ABI note: Playwright drives the built Electron app, so the
  Electron ABI applies — `pnpm run rebuild` before `test:e2e`, same as
  `pnpm dev`.
- **The smoke suite is not the parity proof.** It guards
  boot/restore/terminal/pane *mechanics*; the product surface — PR review
  edge behaviours, provider quirks, config-loader semantics, MCP
  registration, notification rules — is verified per domain against
  [feature-parity.md](./feature-parity.md), using the method each section
  there names (route test, unit test, conformance, live pass). Passing S1–S5
  says the shell works, not that the features survived.

## 2. Route tests (ride Phase 0; expand opportunistically)

The infrastructure exists and is cheap (`createApp()` factory, `getDb(c.env)`
DI, `makeTestDb`, 8 route files already tested). Priority order, by risk:

1. **`prActions.ts`** — 44 error sites, merge/close/comment against GitHub,
   zero tests. Stub `fetch`; assert each action's success mapping and the
   error envelope for GitHub 4xx/5xx.
2. **`prCreate.ts`** — the 422-prose leak (`prCreate.ts:122`) gets pinned by a
   test the moment Phase 0 fixes it.
3. **`harness.ts`** — the whole agent surface. Auth (INTERNAL_TOKEN present /
   absent / wrong), the `respond()` envelope, one test per bridge verb.
   Becomes the projection conformance test in Phase 4 (one test per projected
   tool, table-driven off the registry).
4. **One migrated router per Phase 3 domain PR** — each PR that moves an IPC
   domain to HTTP routes carries tests proving: happy path, 401 without a
   session ([security.md](./security.md) §7), and input rejection on malformed
   bodies for anything that writes. The security-sensitive domains carry
   more ([feature-parity.md](./feature-parity.md) §7/§14): editor/git/search
   routes get **path-traversal, symlink-escape, missing-worktree, and
   stale-buffer** cases; the database routes get SQL-surface cases —
   generated-SQL identifier validation rejects non-introspected identifiers,
   the connection URL is never persisted, pools tear down on disconnect.
5. **Phase 2's sync engine** — unit tests on the extracted state machine
   (fresh / stale-serve-and-refresh / cold-block / 304 / backoff), which is
   precisely the logic too risky to keep testing five separate hand-rolled
   copies of.
6. **Phase 7's provider regression tests** — before (or with) the provider
   port, pin the Linear/Rollbar behaviours the generic provider contract
   doesn't express ([feature-parity.md](./feature-parity.md) §6):
   first-hit-wins bare-id resolution, workspace-scoped project links,
   `branchName` branch seeding, threaded replies, XSS-safe markdown;
   Rollbar stale-cache-beats-nothing, counter-string identity, `+task`
   promotion. The Sentry dry run proves extensibility; these prove parity.
   The *contract-obedience* side — codecs, stamped provider ids, lifecycle
   semantics, capability obligations — is the integration conformance suite
   (§4, [integrations.md](./integrations.md) §18), table-driven off the
   provider descriptor, landing with the same phase.

Convention for all of these: security assertions (401/403 paths) live in the
same file as the happy path — a parameterized "every route rejects
unauthenticated" test over the router table is ~20 lines and closes the
forgotten-guard hole permanently.

## 3. Main-process logic tests (structural precondition, not a suite)

The main-process wiring is untested because handler bodies are bound inside
registrars (`ipcMain.handle('x', async () => …)`) and can't run without
Electron. The fix is the pattern `runtime.ts`/`runConfig.ts` already follow:
**handler bodies are exported functions; registration is a thin loop.**
Phase 3 does this implicitly (bodies become route handlers, testable via
`createApp()`); for whatever remains in main (PTY engine, reconcile,
teardown), split body from registration as those files are touched. No
dedicated "test main" project — the split *is* the deliverable.

## 4. Plugin conformance suite (Phase 5 onward)

A small shared suite that every pane/contribution runs — the cheapest
insurance that the contracts in [extensibility.md](./extensibility.md)
§3/[contribution-points.md](./contribution-points.md) §4 stay true as
contributors multiply:

- **Pane renders from a bare `{ task }`** — no router provider in the test
  harness, so any `useParams()` read throws. (This pins the Phase 5 `pr`-pane
  contract fix and prevents recurrence.)
- **Pane content is keyboard-navigable** ([contribution-points.md](./contribution-points.md)
  §4.1, [ux.md](./ux.md) §7–§8) — every focusable element is reachable by
  keyboard (no positive `tabindex`, no focusable-but-unreachable content),
  collections expose a single roving tab-stop, and `focusin` marks the pane the
  focused surface. This is what makes "keyboard-navigable by default" a
  build-time obligation rather than a hope; `keepAlive`/editor/terminal panes
  are exempted for their internal focus per the §4.1 carve-out.
- **`activate()` only registers** — run it with a `ctx` whose services throw
  on use; activation must complete. Disposal returns the registry count to
  its pre-activation baseline (leak check).
- **Persisted-state parsers tolerate unknown ids** — feed each parser a blob
  containing an unregistered pane/source id; assert retained-but-inert, no
  throw (tenet 6).
- **Persisted-state descriptors are valid** — every registered T3 slice has a
  namespaced key, scope, restore phase, version, codec, unknown-id policy, and
  budget. Feed each codec current, legacy, malformed, and oversize payloads;
  assert malformed input falls back without throwing to callers.
- **Pane layout reducer invariants** — resize clamps against contributed
  `minWidth`, weights are keyed by pane id across reorder/close/reopen, pinned
  panes survive `show`, maximize is absent from persisted layout, and unknown
  pane ids are retained-but-inert.
- **Reaction rules** ([ui-state.md](./ui-state.md) §3) stay review-enforced,
  not machine-enforced — a lint rule for `void somePromise()` without catch is
  the one cheap automation worth adding.
- **Integration providers get their own conformance table**
  ([integrations.md](./integrations.md) §18, lands with Phase 7): per
  registered provider — no secrets in public responses, provider id derived
  from the connection on link writes, codecs tolerate old/malformed blobs and
  list-over-detail merges preserve detail, panes/context degrade on
  missing/stale/deleted/malformed cache, lifecycle operations
  (disconnect/disable/reauth/rotate) touch exactly the documented rows, and
  every declared capability has its obligations (a `comments: 'write'`
  provider has the mutation + invalidation policy). The goal is not mocking
  upstream APIs; it is proving every provider obeys the app contract.

Table-driven: one spec iterates the registries, so a new contribution is
covered by writing zero new test code.

## 5. What deliberately has no tests

- **Component/DOM tests** — the pure-model discipline covers the logic;
  the smoke suite covers integration. Adding a component-test layer would be
  the highest-maintenance, lowest-yield suite available. (Revisit only if a
  class of UI bug recurs that S1–S5 can't be extended to catch.)
- **Perf benchmarks in CI** — [performance.md](./performance.md) §4: marks +
  the observability log + budgets, checked by a human when a phase's verify
  step says "compare marks".
- **Coverage gates** — coverage is an input to judgment, not a gate.

## 6. When each lands

| Suite | Lands | Blocks |
| --- | --- | --- |
| Smoke S1–S5 | before Phase 3 starts | Phases 3, 5, 6 |
| `prActions`/`prCreate`/`harness` route tests | with Phase 0 (same PRs where practical) | nothing, but do them first — they're the cheapest risk reduction available |
| Sync-engine unit tests | inside Phase 2 | Phase 2's done-criterion |
| Per-domain route tests | inside each Phase 3 domain PR | that PR |
| Projection conformance tests | inside Phase 4 | Phase 4's done-criterion |
| Plugin conformance suite | with Phase 5's registries | the litmus-test claim (a contribution is trustworthy without core review) |
| Provider regression tests (Linear/Rollbar) | before/with Phase 7's port | Phase 7's parity claim — the Sentry dry run alone doesn't prove it |
| Integration conformance table ([integrations.md](./integrations.md) §18) | with Phase 7's descriptor registry | Phase 7's done-criterion — the minimum-contract gate before provider #3 |
