# Post-implementation review — docs/next

**Date:** 2026-07-11 · **Scope:** the shipped state of `apps/desktop/src` at `41adadc` (phase 10)
measured against the goals in `docs/next` (implementation.md, its phase files, and the
cross-cutting gate docs) · **Method:** six parallel audits — boundary ledger, testing,
feature parity, security invariants, ongoing tracks, and phase deviations — each verified
against code, not docs.

`docs/next` is graduating to design history in a parallel docs pass; this file is the
forward-looking punch list that replaces it. Everything below is a note on something to
**fix, tweak, test, or alter** — ordered by how much it matters.

---

## Verdict

The implementation landed remarkably clean. All ten security invariants in `security.md` §2
hold with code citations; registry adoption is complete with no stragglers (routes, providers,
agent tools, panes, commands, settings, pollers, step kinds, profiles all go through their
registries); the sync-engine divergence the original review called the "single highest-leverage
server refactor" is gone; the tree has **zero** TODO/FIXME/HACK markers and effectively zero
`any` escapes. Nothing found is broken or secretly half-done.

The real remaining work is concentrated in four places:

1. **One genuine security gap** — the repo-config trust gate was specified and never built.
2. **The smoke suite never landed** — the gate that was supposed to block Phases 3/5/6 is 0/5.
3. **The boundary ledger** — 82 baselined coupling edges, but with a clear burn-down plan
   (one seam removes ~29 of them).
4. **Verification debt, not construction debt** — 106 unchecked parity rows of which ~88 are
   "code is present, nobody has run the verify pass."

---

## 1. Fix — security and correctness

### 1.1 Repo-config trust gate is entirely absent (HIGH — the one real security gap)

`security.md` §5 and `ux.md` §2 specify a first-execution trust prompt before anything from a
repo's committed `.acorn/config.toml` runs. None of it exists: no `config_acks` table, no
config hash, no needs-trust error anywhere in the tree. Today the execute-tier
`run_start`/`run_restart` tools (`app/main/agentToolsWiring.ts:359-414`) and the renderer run
route (`core/server/routes/harness.ts:59-61`) execute run targets and lifecycle scripts merged
from checked-out repo config (`loadRepoConfig`, `core/main/taskWorktree.ts:204`)
unconditionally. The threat this defends — clone a repo, its committed config executes
commands — is live and was a stated §1 threat, so this is a dropped mechanism, not a descoped
one. Every §2 invariant holds; this §5 mechanism is the gap.

**Do:** build it per the existing spec (hash the repo config layer, `config_acks` row keyed by
repo+hash, needs-trust error from `run_*` tools + notice with "Review & trust" action showing
the verbatim commands, diff view on change). Until then, acorn should not be pointed at
untrusted clones.

### 1.2 Latest-only guards on the two flagged stores

`ui-state.md` §2.3 named exactly two event-driven stores with out-of-order clobber races, and
both are still unguarded — each is driven concurrently by a WS status ping *and* a poller:

- `plugins/terminal/client/sessions.ts:13-20` — bare `await api.list()` → `setSessions(next)`,
  and `trackSessionEdges` reads current state at completion time (the phantom-edge race).
- `core/client/tasks/taskStatus.ts:16-21` — same shape.

**Do:** one small `latestOnly(fn)` helper (generation counter), applied to both. The doc's rule
2 asked for the helper; it was never written.

### 1.3 `submitDraft` swallows task create/rename failures

`core/client/tabs/TabRail.tsx:170-192` has no try/catch around
`createTask`/`renameTask`/`createCheckoutTask`: a rejection is an unhandled promise, the modal
stays open, nothing is surfaced. This is the second half of `ui-state.md` §2.1 (the `savePref`
half was fixed properly). The archive flow next to it (`setArchiveErr`, `:213`) is the pattern
to copy.

### 1.4 Rewrite the stale `browser:bind` contract rows

Feature-parity §13 and inventories §1c still assert "`browser:bind` stays IPC-only forever."
Phase 9A deleted the channel — main now binds CDP directly when it creates the
`WebContentsView` (`plugins/preview/main/previewService.ts:60-62`), which is strictly better
(no `webContents` id crosses the bridge). The rows contradict shipped code and can't be ticked
as written. **Do:** rewrite them to describe the new contract ("main-owned bind, no id over
IPC") in whatever home the parity checklist graduates to.

---

## 2. The Phase-10 acceptance gate — what actually remains

Phase 10's pause conditions were: empty boundary ledger, verified parity checklist, docs
graduated. Current state of each:

### 2.1 Boundary ledger: 82 edges, burn-down plan

`core/boundaries.test.ts` hard-fails `→app` and client↔node process edges (both already zero)
and freezes 47 core→plugin + 35 plugin→plugin edges as a shrink-only ledger. The clusters and
the levers, in leverage order:

| Lever | Removes | Effort |
| --- | --- | --- |
| **Terminal client capability seam** — register the terminal client API (terminalApi/sessions/runClient) behind the existing `capabilities().terminal` accessor instead of deep imports from core shell + 6 sibling plugins | **~29 edges** | High but mechanical; terminal is the hub of both lists |
| **Split `plugins/github/client/mutations.ts`** — it's misfiled: task, workspace, integration, and pref mutations live in the github plugin. Move them to core-owned client modules; leave PR mutations | ~9–10 edges | Medium — pure file split |
| **Move misfiled generic utilities** — `debounce` (in editor/autosave), `shiki.ts` (generic, in github), `theme.ts` (generic, in terminal), `formatRelativeTime`/`fileStatusMeta` (in github/displayMeta), git/worktree helpers (`isContainedPath`, `isDirty`, `worktreeBranchDirName`… in terminal/terminalUtils) | ~10 edges | Low — trivial moves; do `shiki` before `theme` |
| **Persisted-state descriptor adoption** — `persistence/scopedEviction.ts` + `stateSlices.ts` already ride `clientEvents` for lifecycle but still statically import every plugin's `evict*`/`hydrate*`; the descriptor half of the seam is missing | ~7–8 edges | Medium — registry pattern half-built |
| **Pane/uiSlots/provider adoption for App.tsx** — the github PR views (6 edges), OnboardingModal, AgentsPanel, MemoryTray, Linear cross-ref panel are hard-mounted; the registries they should ride all exist | ~10 edges | High — the PR view is the app's primary surface |

Two clusters are genuine **cycles** that a move alone can't fix: github↔linear (needs the
provider-contract cross-ref seam) and terminal↔agents (`terminal.ts` imports `agentSend`;
needs a sender contract, the `setAgentTools` setter-injection pattern is the precedent).

**Suggested order:** utilities first (cheap, ~10 edges, zero risk), then the mutations split,
then the terminal capability seam (the big one), then descriptors, and treat the App.tsx
main-view adoption as its own deliberate slice — it's the largest architectural change left
and shouldn't be rushed to zero a counter.

### 2.2 Parity checklist: 106 unchecked, but mostly verification debt

Exact census: 122 rows, 16 checked, 106 unchecked. Breakdown of the 106:

- **~88 are "code present, verify pass not run."** Spot-checks of the eleven riskiest rows
  found zero code breaks — imports resolve, routes/panes/handlers still registered
  (`boundaries.test.ts` would fail CI on orphans). These need a scheduled verification
  sweep (route tests where named, live walkthrough for §12 settings, the §5 diff perf-marks
  pass on a 100+ file PR), not engineering.
- **~9 are blocked on named pending items:** §13 preview rows on the Phase 9A interactive
  sign-off (see §5.1 below); the §16 safeStorage row — **re-check this one**: Phase 9C landed
  (`core/main/sessionKeyStore.ts`), so the row may now be satisfiable as written; the §18
  docs-overhaul row is mooted by the docs graduation and needs a new home or a strike.
- **1 is contradicted by code** — `browser:bind` (§1.4 above).
- **0 hidden non-goals** — the doc already strikes true non-goals inline.

Also: **inventories.md over-reports open work.** §3b/3d/3e/3f/3g/3h (keydown listeners, panes,
palette actions, mailbox signals, alert/confirm sites, polling sites) were all consumed by
Phase 5/6 — e.g. `window.alert`/`confirm` sites are now **zero** — but the ✓ markers were
never applied. If inventories.md survives as history, tick the consumed sections in the
graduation pass so history reads true.

### 2.3 Docs graduation: in progress, nearly clean

The parallel docs pass is handling this. Independent findings worth folding in: `docs/`
(excluding next/) has exactly **one** stale pre-foldering path — `docs/electron.md:459`
references `src/client/**`; CLAUDE.md and README both correctly describe the shipped layout,
with a cosmetic inconsistency in CLAUDE.md (lines 16–17, 34) mixing bare `src/...` with
`apps/desktop/src/...` prefixes.

---

## 3. Test — the gaps, in priority order

### 3.1 The smoke suite never landed (0/5)

`testing.md` §1's five-test Playwright-Electron suite (S1 boot, S2 restore, S3 open-task,
S4 terminal-echo, S5 quit-clean) was a hard gate: "must land and pass on main before Phase 3
starts." There is no `@playwright/test` dependency, no spec, no `test:e2e` script. Phases 3,
5, and 6 shipped ungated, and the risks it was scoped to cover are exactly the remaining
untested surfaces:

- **S2/restore:** `startupRestore` has good unit/integration tests of descriptor logic, but
  the real twice-launched-app race class — the reason S2 exists — is unreachable by unit tests.
- **S5/quit:** no teardown/orphaned-PTY test of any kind.
- **S1/boot:** `app/main/bootstrap.ts`, `electron.ts`, `serverBridges.ts`, `harnessWiring.ts`,
  `workflowWiring.ts` are essentially untested (only the two wiring `.test.ts` exceptions).

The prerequisite auth seam (`core/server/routes/testAuth.ts`) already exists, so the suite is
unblocked. (`scripts/smoke-browser.cjs` is a different, narrower CDP proof for the preview
driver — it does not substitute.) **Decide explicitly:** build S1–S5 now (recommended — this
is the insurance for all future refactors, and the boundary burn-down in §2.1 will churn
exactly the wiring it covers), or formally re-scope the gate in the graduated testing doc.
Silently shipping past a "must land before Phase 3" gate is the one place process and reality
diverged.

### 3.2 `wsClient.ts` has zero tests

The renderer half of the WS transport (`core/client/wsClient.ts` — reconnect, backoff,
attach-replay handling) has no test of any kind, while the server hub is well covered
(`core/main/wsHub.test.ts`). This is the load-bearing transport for every terminal pane.

### 3.3 Conformance suites: only 1 of ~4 exists

`testing.md` §4's registry-iterating conformance model is proven — the integrations one
(`core/server/integrations/conformance.test.ts`) is excellent — but it's the only one:

- **Pane conformance: none.** Nothing iterates `core/client/registries/panes.ts` asserting
  "renders from bare `{ task }`," keyboard navigability, or activate/dispose hygiene.
- **Persisted-state conformance: piecemeal.** Each codec tests its own unknown-id tolerance,
  but no single suite iterates every registered T3 slice feeding current/legacy/malformed/
  oversize payloads.
- **Workflow step-kind / profile registry conformance: none** (behavioral coverage via
  `workflowRunner.test.ts` is strong, but nothing iterates the registries).

These are cheap now that the registries exist, and they're what makes the "plugin additions
don't require core edits" claim stay true.

### 3.4 Route-test gaps: the GitHub read family

Route contract coverage is strong (parameterized `requireUser` table over 19 paths, mount
table, envelope test, and the three §6 priorities — prActions, prCreate, harness — all done).
The remaining behavioral gaps, ~11 files: the GitHub read path (`actions.ts`, `mentions.ts`,
`prContext.ts`, `prMirror.ts`, `pullBlob.ts`, `pullDetail.ts`, `pullFiles.ts`,
`repoLabels.ts`) plus core `integrations.ts`, `pins.ts`, `prefs.ts`. Many parity §4 rows name
route tests as their verification method, so this list and §2.2's sweep are the same work.

### 3.5 Two small targeted tests the security audit asked for

- **Terminal `create` cwd bounding:** `plugins/terminal/main/terminal.ts:302` is the one place
  a renderer-supplied absolute path is honored (as a base-checkout candidate, guarded
  `isAbsolute && isDir`). Not a violation, but it deserves a bounding test so it stays the
  only one.
- **WS internal-token negative case:** `wsHub.ts:52-53` lets a valid `x-acorn-internal` token
  skip Origin/cookie checks (by design, for loopback MCP). Add the explicit test that a
  wrong/absent token still 403s.

---

## 4. Tweak — small, worth doing when nearby

- **Two skipped indexes** from performance.md §3.5 ("worth adding regardless"):
  `pull_requests (userId, repoId, state, updatedAt)` — `pulls.ts:67-71` filters/orders on
  exactly this with only the PK — and `terminal_sessions (taskId)`. One migration.
- **PR list refetch visibility gate:** `core/client/queries.ts:120`'s 60s `refetchInterval`
  relies on TanStack's default focus-pause; add `refetchIntervalInBackground: false` (or move
  it onto the poller registry) per performance.md §3.2.
- **`workflowValidation.ts` kind ladder:** execution is fully registry-backed, but
  `plugins/workflows/main/workflowValidation.ts:65-116` still branches on
  `gate-policy`/`join`/`decide` for shape validation — the one place a new step kind touches a
  hardcoded switch. Move a `validate(step)` hook onto the step-kind descriptor.
- **`repoMirror.ts:11` re-export hop:** re-exports `RouteFailure`/`RouteResult` from the sync
  engine "for existing importers"; one importer remains (`prMirror.ts:9`). Point it at the
  engine and delete the shim.
- **CLAUDE.md path-prefix consistency** (§2.3 above) — cosmetic, ride the docs pass.
- **`ponytail:` debt ledger:** 54 deliberate-shortcut markers in tree. Not action items, but
  worth harvesting into a visible ledger once so the ceilings they name (e.g. the preview
  occlusion centre-point probe, the 5s task-status poll) are tracked decisions rather than
  archaeology.

---

## 5. Alter or explicitly re-decide

Items where the right move is a decision (or a written non-goal), not code:

### 5.1 Phase 9A preview — run the human sign-off, then close it

Code-complete: no dead `<webview>` code, no `webviewTag`, `browser:bind` fully gone, nav/attach
policy carried over (`previewService.ts:43-49`), CDP smoke passes. All that's left is the
interactive pass a human must drive (visual check, pane/task-switch state preservation, live
occlusion behavior). Doing it unblocks most of parity §13. Known documented ceiling to accept
or not: occlusion detection is a single centre-point probe at ~200ms (`PreviewPane.tsx:44`) —
corner overlaps go undetected.

### 5.2 `workspace_config` table — absent; decide if that's the design

The data-model hygiene track named a `workspace_config` table; it doesn't exist. Config is
file-based (`runConfig.ts` layered `.acorn/config.toml`) plus `integrations.config` JSON. This
looks like an intentional design shift — if so, write the one-paragraph non-goal; if not, it's
still open. Note it interacts with §1.1: the trust gate needs *somewhere* to store config
acks, which may resurrect a slice of this table anyway.

### 5.3 Retention sweep — deferred by design, name the trigger

Blob cache is unbounded by design (`core/server/blobs.ts:3`, `bindings.ts:52` — "no TTL and no
delete") and no age-based row pruning exists; the only deletion is mirror list-reconciliation.
Fine for a single-user local app *today*, but it's storage rot with no owner. **Do:** don't
build the sweep; add the trigger — a startup log line (or settings-page stat) of blob-dir size
and mirror row counts, so growth is visible and the sweep gets built when a number, not a
guess, says so.

### 5.4 Lineage-derived cascade/prune/index — still hand-maintained

`tasks.parentId` and `workflow_steps.parentStepId` landed, but the "one lineage declaration
drives cascade + prune + index" vision didn't: `db/cascade.ts` is still a hand-written delete
list and migration 0021's indexes were hand-added. Acceptable, but it means the original
review's §5 finding (referential invariants by reviewer discipline) still stands. Revisit when
the next parent-child table lands — that's the moment the registry pays for itself.

### 5.5 Deliberate deviations that are healthy — keep, they're documented

For the record, these were re-verified and should *not* be "fixed":

- **`pullsBatch` off the sync engine** — documented (`pullsBatch.ts:19-22`), shares
  `PULLS_STALE_AFTER_MS` and the same mirror helpers; a batch has no single resource to serve
  stale. The old divergence (duplicate TTLs, three cold-detections) is gone.
- **Linear multi-connection fan-out off the engine** — documented (`linear.ts:35-38`), reads
  its TTL from the provider descriptor; single-issue detail *is* on the engine. Legitimate.
- **The two `resolveRepoForUser` deviations** (`mentions.ts:6-9` best-effort mirror-only;
  `prContext.ts:20-24` deliberately stricter on the write path) — both present, documented,
  correct.
- **node:sqlite parked** — right call (Drizzle has no first-party driver at 0.45.2, and
  node-pty keeps dual-ABI alive regardless). Revisit trigger is written in
  `docs/local-development.md`: Drizzle ships a `node:sqlite` driver.
- **Legacy persisted-format readers** (`task_panes` fallback, flat `TaskContext` envelope) —
  these are stored-data migrations, not shims; keep.

---

## 6. What's healthy — don't churn it

Verified strengths to leave alone: all ten §2 security invariants hold (loopback bind,
host/Origin/CSRF guards on HTTP *and* WS upgrade, session/key handling, per-run
`INTERNAL_TOKEN`, tokens encrypted at rest and never serialized, `resolveInRoot` lexical +
symlink confinement, BrowserWindow/WebContentsView hardening, minimal preload); route mounting
is structurally forced inside `/api` behind `requireUser` (`routeRegistry.ts:15-17` throws
otherwise); the sync engine with centralized policy TTLs, in-flight dedupe, and backoff is
done and tested; autosave clobber guarding, run-scoped workflow handoffs, the poller registry,
and `savePref`'s failure surface are all complete; and the tree carries zero TODO markers and
no unsafe `any`. The registries are real: adding a route, provider, tool, pane, command, step
kind, or profile today touches registration in `app/`, not core.

---

## Suggested sequence

1. **Now:** repo-config trust gate (§1.1) · `latestOnly` guards + `submitDraft` catch
   (§1.2–1.3) · the two-index migration (§4).
2. **Next slice:** smoke suite S1–S5 (§3.1) — it insures everything after it.
3. **Then, boundary burn-down in leverage order** (§2.1): utility moves → mutations split →
   terminal capability seam → persisted-state descriptors → App.tsx main-view adoption.
   Each slice deletes its ledger lines in the same PR.
4. **Alongside:** Phase 9A sign-off (§5.1, unblocks parity §13) · parity verification sweep +
   route tests for the GitHub read family (§2.2/§3.4, same work) · conformance suites (§3.3).
5. **On triggers, not now:** retention sweep (§5.3) · lineage registry (§5.4) ·
   node:sqlite (§5.5).
