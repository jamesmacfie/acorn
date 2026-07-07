# Performance

**Status:** findings + plan · **Date:** 2026-07-07 · **Companions:** [review.md](./review.md),
[implementation.md](./implementation.md)

review.md's lens was composability/extensibility/maintainability; performance was out of scope.
This doc closes that gap. It is grounded the same way — a sweep of the actual code, every claim
with a file:line — and it reaches a deliberately lazy conclusion: **acorn does not need a
performance workstream; it needs a baseline, five small fixes folded into phases that are already
planned, and one constraint written down so planned refactors don't undo the best perf work in the
codebase.** No perf framework, no benchmark CI, no speculative optimization.

The structural risk is specific: [implementation.md](./implementation.md) rebuilds the three most
performance-sensitive paths in the app — boot (Phase 1), transport (Phase 3), startup restore
(Phase 6) — and the app currently has **zero instrumentation**, so a regression introduced by any
of them would be invisible. Phase 3's own done-criterion ("no visible regression under a busy
TUI") is unverifiable today.

---

## 1. Baseline facts

### 1.1 Instrumentation: none

No `performance.mark`/`performance.measure`, no `console.time`, no timing logs anywhere in
`apps/desktop/src`. The sole timing measurement in the app is the database pane's per-query
`process.hrtime.bigint()` (`main/database.ts:202-205`). There is no way to answer "did boot get
slower" except by feel.

### 1.2 SQLite: zero secondary indexes

`db/schema.ts` declares only primary keys — no `index()`/`uniqueIndex()` anywhere; across all 20
migration files the only index-like object is the `memories_fts` FTS5 virtual table
(`migrations/0011_whole_silvermane.sql:19`). WAL and `busy_timeout` are set
(`main/bindings.ts:110-111`). Consequences, today invisible because the DB is small:

- The PR list filters on `state` and orders by `updatedAt` (`server/routes/pulls.ts:67-71`) —
  neither indexed; the composite PK `(userId, repoId, number)` covers only the repo prefix.
- `issues` is queried by `provider`, which is not a PK-prefix column (`db/schema.ts:497`).
- `terminal_sessions`, `workflow_steps`, and other task-scoped tables are looked up by
  `taskId`/`runId` — plain columns, full scans (`db/schema.ts:423-440`, `:460-481`).

This decays exactly along the axis the retention findings (state §5.2, review §5) already name:
unpruned rows accumulate, and the scans that read them are linear.

### 1.3 Polling never pauses

Grep for `visibilitychange` / `document.hidden` / `visibilityState` across the app: **zero
matches**. Meanwhile:

| What | Interval | Where |
| --- | --- | --- |
| Agents panel runs+steps refetch | 3 s | `features/agents/AgentsPanel.tsx:45` |
| Task status (dirty/checks) | 5 s | `features/tasks/taskStatus.ts:28` |
| Open-PR list `refetchInterval` | 60 s | `client/queries.ts:120` |
| Main-process idle watch | 3 s | `main/terminal.ts:242-254` |

plus `refetchOnWindowFocus: true` globally (`client/index.tsx:26`) with no global `staleTime`
(default 0 — everything is stale immediately). For an app that sits open all day, the hidden
window burns the same CPU/network/GitHub-rate-limit as the focused one.

### 1.4 The client cache persists everything, unthrottled

The IndexedDB persister (`client/index.tsx:31-39`) persists the **whole** query cache
(`maxAge` 24 h, no `dehydrateOptions` filter, no `throttle` option), and the cache contains
unbounded payloads: `pullBlob` returns entire decoded file bodies with no size cap
(`server/routes/pullBlob.ts:36-43`); patch bodies are uncapped per file
(`server/routes/pullFiles.ts` caps *paths per request* at 20, not bytes). Every cache write can
schedule a serialization of the full cache to IDB. This is also the one retention surface the
retention plan (state §5.2) doesn't cover — it names SQLite rows and the disk blob store, not
IndexedDB.

### 1.5 Boot does usage-proportional work before the window exists

`app.whenReady` awaits `startServer` then `registerTerminalIpc` **before** `createMainWindow`
(`main/electron.ts:116-119`). Inside that: synchronous Drizzle migration on the main thread
(`main/bindings.ts:114`), then `reconcileTmux` — which selects all `terminal_sessions` rows,
shells out to `tmux`, and does a `loadTask` per row (`main/terminal.ts:367-387`) — then worktree
prune. Boot time therefore grows with accumulated sessions/worktrees, and (per §1.1) nobody would
notice.

### 1.6 The PTY path is per-chunk with no flow control

Every `pty.onData` chunk is immediately `wc.send`-ed to each subscriber
(`main/terminal.ts:214-223`, `:110-115`) — no coalescing, no backpressure, and each chunk also
touches `lastActivityAt`/status. The client writes each chunk straight into xterm
(`features/terminal/TerminalSurface.tsx:43`). The replay ring is 256 KiB per session
(`main/terminalUtils.ts:6`).

### 1.7 What is already good — and must be preserved

Diff rendering is the perf-mature part of the app and should be treated as the internal reference
implementation:

- Per-line Shiki tokenization with hard cutoffs (`HIGHLIGHT_MAX_PATCH_CHARS = 120_000`,
  `HIGHLIGHT_MAX_PATCH_LINES = 2_000`, `DiffView.tsx:57-58`) falling back to a plain tokenizer.
- Idle-callback hydration in batches of 4 with 80 ms gaps and a priority queue that lets
  visible/selected files jump ahead (`features/diff/hydration.ts:7-8,27-38,61-69`).
- TanStack virtualizers with rAF-batched measurement (`features/diff/virtualization.ts:36-83`).

**Constraint for the component-decomposition track** (implementation.md ongoing tracks): the
DiffView split must keep this scheduling intact — the pure-model extraction is about moving logic
out of the component, not about re-timing the hydration pipeline. Known accepted hotspot: in-diff
find rescans all rows per keystroke (`DiffView.tsx:230-231`, already ponytail-flagged).

The full enumerated contract — dual-theme tokenization cutoffs, hydration batch/priority/
generation guards, the two virtualizers, row-identity key stability, thread-edit rerender without
reparse, sha-keyed gap expansion, split-band laziness — is
[feature-parity.md](./feature-parity.md) §5; Phases 5 and 10 verify against it. A "pure model +
thin view" refactor can preserve screenshots while regressing responsiveness on large PRs — the
contract is *performance semantics*, not appearance.

---

## 2. Budgets

Initial numbers to check marks against — recalibrate once the baseline in §3.1 exists. The point
is that each has a mark, not that the values are sacred.

| Path | Budget | Mark pair |
| --- | --- | --- |
| Cold boot → window interactive | ≤ 1.5 s | main `ready` → renderer first paint + `boot:restored` |
| Task switch | ≤ 100 ms | click → pane body rendered |
| Pane switch | ≤ 16 ms (one frame) | chord → pane visible |
| Pane divider drag ([ux.md](./ux.md) §7) | tracks pointer at frame rate; Monaco/xterm refit coalesced to ≤ 1 per frame | pointermove → slot widths applied |
| Terminal keystroke → echo | ≤ 50 ms p95 | `term.onData` → output write |
| Diff open, 100-file PR | ≤ 500 ms to first highlighted file | route → first hydrated file painted |
| Hidden window | ~0 — no timers firing, no polls | (absence, verified by the §3.2 pause) |

---

## 3. The work, folded into the existing plan

Nothing here is a new phase. Each item names where it lands in
[implementation.md](./implementation.md).

### 3.1 Baseline marks — before Phases 1/3/6 touch their paths

A handful of `performance.mark`/`measure` pairs in the renderer (§2's table) and
`process.hrtime`-based timings in main (migrate, reconcileTmux, reconcileWorktrees, listener-up),
written to the JSON-lines log the observability track already plans. Capture a baseline **before**
each of Phases 1, 3, and 6 start, and add "compare marks against baseline" to their verify steps.
That is the entire measurement story — no telemetry, no dashboards; a log you can grep.

### 3.2 Visibility pause — now, independent of everything

~10 lines: a shared `document.hidden` check that pauses the 3 s/5 s client intervals and skips
`refetchInterval` ticks while hidden (TanStack accepts a function for `refetchInterval`). This
should **not** wait for the `ctx.poll` scheduler (state §5.2) — the scheduler subsumes it later;
the one-liner stops the bleeding today. When `ctx.poll` lands, visibility-awareness moves into it
and the ad-hoc checks are deleted.

### 3.3 PTY output coalescing — Phase 3, as part of the WS migration

The IPC→WS move is the natural moment to stop sending per-chunk: coalesce PTY output into ~16 ms
frames (one rAF-aligned flush) with the standard xterm flow-control pattern the phase already
commits to. Framed this way the WS migration is a throughput *improvement* to claim, not a
regression to avoid — but only if §3.1's keystroke-echo and busy-TUI throughput marks exist
first, because Phase 3's done-criterion depends on them.

### 3.4 Persister filter + throttle — Phase 6, with the restore pipeline

Add `dehydrateOptions` excluding file-body/patch queries from persistence (they live in the
server-side blob cache already; loopback refetch is near-free) and set a persister `throttle`.
Less persisted → faster IDB restore, which compounds with Phase 6's whole purpose. This is also
the retention answer for the client cache tier. Tie this to the persisted-state descriptor
contract ([state-and-policies.md](./state-and-policies.md) §5.1a): every T3 slice declares a
`maxBytes` guardrail, serializes only durable arrangement, and excludes reconstructable payloads.
Restore cost is the sum of registered slices, so plugins must make their footprint visible before
they can persist state.

### 3.5 Indexes derived from the lineage registry — data-model hygiene track

ext §8.5 already plans table contributions declaring parent lineage, with cascade + prune derived
from the registry. Derive the **index** from the same declaration: a declared parent column gets
a secondary index in the generated migration. One declaration → three artifacts (cascade, prune,
index). Independently of that registry, two indexes are worth adding in the next schema
migration regardless: `pull_requests (userId, repoId, state, updatedAt)` for the list route, and
`workflow_steps (runId)` / `terminal_sessions (taskId)` for the task-scoped scans.

### 3.6 Boot policy — Phase 1, written into the composition root

State the ordering rule explicitly: **create the window as soon as the listener is up; run
`reconcile()` after, off the critical path.** Reconciliation (tmux resurrect, worktree prune, the
planned retention sweep) is exactly the work that grows with usage, and the sessions it recovers
are not needed to paint the shell. The synchronous migration stays pre-listener (the server needs
the schema); it gets a timing log entry (§3.1) so slow migrations are at least visible.

---

## 4. Non-goals

- **No perf framework, no benchmark suite, no CI perf gates.** Marks + the observability log +
  budgets in §2 are the whole apparatus. Revisit only if a budget is repeatedly blown and the
  cause isn't obvious from the marks.
- **No optimization of the diff pipeline.** It is already the best-engineered path (§1.7); the
  obligation is to not regress it.
- **No speculative caching/memoization sweeps.** Every item in §3 traces to a measured-or-obvious
  mechanism, not to taste.
