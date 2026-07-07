# UI state reaction — how changes propagate, and how they fail

**Status:** findings + rules · **Date:** 2026-07-07 · **Companions:** [review.md](./review.md) §4,
[state-and-policies.md](./state-and-policies.md) §5.1, [implementation.md](./implementation.md) Phases 5–6

state §5.1 answers *where state lives* (tiers, scopes, one writer). review §4 answers *how startup
restores it*. This doc answers the third question: **when state changes at runtime, how does the
UI find out, and what happens when the change fails?** It is grounded in a sweep of the reaction
mechanics — all 74 `createEffect`s, every mutation flow, every cleanup path, both event-driven
refresh stores.

The verdict: the *reading* side is in good shape — the Solid discipline is real (§1). The
*writing* side is where robustness leaks: mutations fail silently or loudly-but-inconsistently
(§2.1–2.2), and the two event-driven stores can be clobbered by out-of-order responses (§2.3).
None of it needs new machinery; it needs three small rules (§3) and fixes that ride phases
already planned.

---

## 1. What is already right (and must stay right)

- **No destructured props anywhere** — every component takes a single `props` param; the classic
  Solid reactivity-loss trap simply doesn't occur in this codebase.
- **No `createStore`, no query→store copying.** State is signals + the query cache; state §5.1's
  "query cache is the only client copy" rule is *already true* on the read side. The handful of
  query→signal seeds that exist are the sanctioned form-seeding pattern, correctly guarded by a
  `touched()` flag so user input is never clobbered by a refetch (`CreatePullForm.tsx:39-45`,
  the collapse pref in `App.tsx:276-278`).
- **Disposal is guarded where it burned before**: `TerminalSurface`'s `disposed` flag +
  `safeFit` (`TerminalSurface.tsx:27-33,73-77`), Monaco model disposal (`EditorPane.tsx:96-98`),
  hydrator `dispose` (`DiffView.tsx:146`). Listener/interval cleanup via `onCleanup` is the norm
  (~20 sites); the exceptions are deliberate (module-scope logout listener, `index.tsx:52`) or
  part of the known webview-eviction story (`PreviewPane.tsx:119-131`, retired by the
  `keepAlive` slot + `WebContentsView` work).
- **The two real staleness guards are exemplary and should be the template**: the diff
  hydrator's `generation` counter re-checked after every await (`features/diff/hydration.ts`)
  and `PreviewPane`'s `isActive(captured)` webview-callback guard (`PreviewPane.tsx:119-121`).

---

## 2. Findings

### 2.1 Mutations can fail silently (the robustness hole)

- **`savePref` has no failure path at all** (`features/settings/savePref.ts:7-10`): it awaits the
  POST, then updates the cache — and every caller invokes it as `void savePref(...)`
  (`AppearanceSettings.tsx:25-59`, `ShortcutsSettings.tsx:42,71`, `TerminalSettings.tsx:18`, …).
  A failed write is an unhandled rejection: no rollback needed (cache updates only on success)
  but also **no signal to the user** — the toggle they just clicked silently didn't stick.
- **Task create/rename has no catch** (`TabRail.tsx:164-186` `submitDraft`): a rejected
  `createTask`/`renameTask` is an unhandled promise — the modal stays open, nothing is shown,
  the user retries into the void. The archive flow half-handles it: the bridge path surfaces
  errors via `setArchiveErr` (`TabRail.tsx:202-217`) but the fallback branch doesn't.

### 2.2 Four error dialects for the same event

When a mutation *does* handle failure, each feature invented its own surface: inline error
signals (`PullDetail.tsx:133` `actionError`, `LinearIssuePanel.tsx:47-63` `postError` — both
good), `window.alert`/`confirm` (25 sites across 15 files — the full list is
[inventories.md](./inventories.md) §3g; ChangesPane's stage/commit/push/discard is only the
densest), `console` (only `hydration.ts`), or nothing (§2.1). The app already has a notification system (notices + bell +
OS toasts); "a background write failed" is precisely a notice. One surface, not four.

### 2.3 Event-driven stores have no latest-wins guard

`refreshSessions` (`features/terminal/sessions.ts:12-19`) and `taskStatus.refresh`
(`features/tasks/taskStatus.ts:15-20`) are each triggered from **two concurrent sources**
(`api.onStatus` pings + intervals/manual refreshes), do a bare `await api.list()` →
`setSessions(next)`, and nothing prevents two in-flight refreshes resolving out of order — the
older response clobbers the newer store state. `trackSessionEdges` additionally diffs against
`sessions()` read at *completion* time, so a clobber can also fire phantom edge notifications.
This is the same race class the App.tsx restore choreography already paid for, one layer down.
(`AgentsPanel` doesn't have this bug — its refreshes go through `createResource`, which is
latest-wins by construction.)

### 2.4 Effect-as-derivation, contained but multiplying

~8 of the 74 effects write signals that are pure functions of other reactive state — selection
clamps (`overlay.ts:106-110`, `DiffView.tsx:258-261`), active-id derivation
(`TerminalPanel.tsx:48-53`). Each is individually benign; collectively they're the Solid
anti-pattern that turns reaction graphs into write cascades, and the pane/plugin model is about
to multiply contributors. Worth a written rule (§3), not a sweep.

### 2.5 Loading/error rendering is ad hoc; zero Suspense, zero ErrorBoundary

Every component hand-rolls `<Show when={q.data} fallback="Loading…">`; several render
"Loading…" *forever* on error (`CreatePullForm.tsx:79`). The ErrorBoundary half is already
planned (Phase 5's slot boundaries); the loading/error half becomes cheap once Phase 5's UI kit
exists — one `QueryGate`-style primitive in `client/ui/` that renders data/loading/error
consistently, adopted opportunistically.

---

## 3. The rules (three, written down)

1. **Every mutation names its failure surface.** No `void someWrite()` without a `.catch` that
   lands somewhere a user can see — inline signal for foreground actions (the `PullDetail`
   pattern), a notice for background writes (prefs, autosave). `window.alert` is deprecated as
   a surface; the notices system replaces it.
2. **Event-driven stores are latest-wins.** Any `await`-then-`set` store refresh carries a
   generation guard — one tiny shared `latestOnly(fn)` helper (~10 lines, the hydrator's
   counter extracted), or the store becomes a `createResource`. Applies today to `sessions.ts`
   and `taskStatus.ts`; applies structurally to every future `ctx.poll` consumer.
3. **Derive, don't effect.** State that is a pure function of other reactive state is a
   `createMemo` (or computed at read), never a `createEffect` + `set`. Effects are for
   *boundaries* — DOM, IPC, persistence, focus. The `touched()`-guarded form seed is the one
   sanctioned effect-write exception. This joins the pure-model discipline (ext §3.5) as part of
   the pane contract.

---

## 4. Where the fixes land

| Fix | Size | Rides |
| --- | --- | --- |
| `latestOnly` helper; adopt in `sessions.ts` + `taskStatus.ts` | ~10 lines + 2 call sites | now, phase-independent |
| `savePref` catch → notice; `submitDraft` catch → inline error | tiny | now, phase-independent |
| One error surface: mutations report through notices; retire all 25 `alert`/`confirm` sites (inv §3g) | M | Phase 5 (notices are already a registry there; points §4.13; UX rules in [ux.md](./ux.md) §5) |
| `QueryGate` loading/error primitive in the UI kit; adopt opportunistically | S | Phase 5 UI-kit seed |
| Effect-as-derivation cleanups | opportunistic | as files are touched, per rule 3 |
| Slot ErrorBoundaries | — | already in Phase 5 |

## 5. Non-goals

- **No state library, no `createStore` migration, no global reactive framework work.** The
  signal + query-cache architecture is correct; §2's problems are all at the write/error edges.
- **No app-wide Suspense adoption.** The ad-hoc `<Show>` pattern is fine once the error case
  stops rendering "Loading…"; `QueryGate` is a convenience, not a mandate.
- **No sweep to fix all 8 effect-writes.** Rule 3 stops the growth; existing clamps die as
  their files are decomposed anyway.
