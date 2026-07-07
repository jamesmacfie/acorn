# UX — the new surfaces the plan introduces, specified once

**Status:** design decisions · **Date:** 2026-07-07 · **Companions:**
[implementation.md](./implementation.md) Phases 4–5,
[ui-state.md](./ui-state.md), [security.md](./security.md),
[agent-runtime.md](./agent-runtime.md) §3

The implementation plan is architecture-heavy and it introduces real
user-facing surfaces almost as side effects: a confirmation dialog that
aggregates plugin concerns, a trust prompt for repo config, a permissions
page, cancel controls, a unified error surface, keybinding remapping. Left
unspecified, each gets designed ad hoc inside the PR that happens to need it —
by whoever is deepest in the plumbing that day. This doc makes the calls once.
It also states the UX invariants the refactors must not regress (§8).

Design language: everything below composes the existing flat, keyboard-first,
token-styled vocabulary. No new modal framework, no toast library — the
notices system and the existing overlay layer are the only containers.

---

## 1. The will-phase confirmation dialog (Phase 5)

When the user archives a task (or removes a workspace, or quits), core
collects `Concern`s from will-handlers
([state-and-policies.md](./state-and-policies.md) §5) and shows **one**
dialog. Rules:

- **No concerns → no dialog.** Archiving a quiet task is instant, as today.
  The dialog exists to surface state the user can't see, not to add friction.
  (Exception: workspace removal always confirms — it is bulk-destructive.)
- **Concerns render as a flat list**, one line each, severity-glyphed
  (`warn` ⚠ / `danger` ⛔), attributed by feature not plugin id: "Workflow
  'ship-it' is running", "3 uncommitted files", "Agent session active".
  No nested detail, no per-concern buttons.
- **Two actions only**: proceed (danger-styled, names the operation —
  "Archive task") and cancel (default focus when any `danger` concern is
  present; proceed has default focus when all concerns are `warn`). Enter
  confirms the focused action, Esc cancels. No "don't ask again" — concerns
  are dynamic, not preferences.
- **Timeout**: a will-handler gets ~250 ms; a slower one is dropped from the
  list (log line, no UI stall). The dialog never shows a spinner.
- The hardcoded close-task dialog in `TaskView.tsx` and the `confirm()` calls
  in `CommandPalette.tsx:198` / `TabRail`'s archive path become this dialog;
  the six `window.confirm` sites ([inventories.md](./inventories.md) §3g) are
  the candidate list, each converting only when its owning feature registers
  a will-handler.

## 2. The repo-config trust dialog (ongoing track / Phase 8 adjacency)

Shown on first execution of anything from an unacknowledged repo config hash
([security.md](./security.md) §5). Rules:

- **Shows the actual commands**, verbatim, monospace, grouped by section (run
  targets / workflow steps / preview scripts) — the user is deciding whether
  to execute this text; never paraphrase it.
- **Changed config shows a diff**, not the full text again: removed lines and
  added lines, standard diff colors. The headline says what changed: "Run
  target 'dev' changed since you last approved this repo's config."
- Actions: "Trust and run" / "Not now". "Not now" leaves everything runnable
  *except* the repo layer (user + DB layers still work) — the app degrades,
  never blocks.
- **Agent-triggered path**: when a `run_*` tool hits an unacknowledged hash,
  the tool returns a needs-trust error immediately (the agent can relay it)
  and a notice appears with an "Review & trust" action opening this dialog.
  The agent's request is *not* queued for auto-resume — after trusting, the
  user or agent retries. (Silent auto-resume would mean the dialog's answer
  retroactively authorizes an action the user saw fail; keep the causality
  simple.)

## 3. The agent permissions settings page (Phase 4)

A core settings page rendering the tool registry grouped by risk tier
([contribution-points.md](./contribution-points.md) §4.8):

- Three sections — **Read / Write / Execute** — each with a one-line
  plain-language description of what the tier means ("can start processes and
  run commands in your worktrees").
- Per-tier master toggle; per-tool toggles beneath (indeterminate tier state
  when mixed). `read` tier has no master toggle — always on; per-tool
  disabling still allowed.
- Each tool row: name, description (from the contribution — one source of
  truth), and its availability condition when `when` exists ("only in tasks
  with run targets").
- Changes apply **on the next tool-availability evaluation** (immediate for
  new sessions; `tools/list_changed` pushes to live MCP sessions). State
  that on the page in one caption line; no restart language.
- This page is documentation with switches: even a user who never toggles
  anything gets the honest inventory of what agents can do.
- **It is a new page, not a replacement**: the existing Permissions settings
  page (re-requesting GitHub OAuth access) stays as-is
  ([security.md](./security.md) §2 invariant 10). Two different questions —
  "what may agents do locally" vs "what may acorn do on GitHub" — two pages.

## 4. Keybindings: conflicts, remapping, help (Phase 5)

The registry ([contribution-points.md](./contribution-points.md) §4.4) needs
three UX decisions:

- **Conflict policy: last-registrant loses, loudly.** A contribution whose
  chord collides with an existing binding or `RESERVED_CHORDS` registers
  *unbound* and shows in the shortcuts settings page with a "conflicts with X"
  annotation and an empty chord the user can remap. Never silently steal a
  chord; never crash.
- **Remapping** generalizes the existing `pane_shortcuts` capture UI to all
  registry bindings: click the chord, press the new one, conflicts checked
  live against the registry (the current dialect that only knows pane chords
  goes away). Reset-to-default per row.
- **The help overlay (`?`) renders the registry** — grouped by category,
  showing *effective* chords (post-remap), omitting unbound ones. It cannot
  lie because it has no independent content. Bindings whose `when` is
  currently false render dimmed, not hidden (discoverability beats precision
  here).

## 5. Errors the user can see (Phase 5, rules from ui-state.md §3)

The four dialects (inline signals, `window.alert` ×19, console, silence)
become two:

- **Foreground actions fail inline**: the error renders where the user acted
  (the `PullDetail.actionError` pattern) — button-adjacent text, cleared on
  retry. Every `alert()` in a pane converts to this.
- **Background writes fail as notices**: autosave, `savePref`, background
  refresh — bell + notice row, OS toast only for data-loss-shaped failures
  (autosave clobber refusal, workflow failure). Notices name the action and
  offer retry where the mutation is idempotent.
- `window.alert`/`window.confirm` are banned after Phase 5 (lint-greppable;
  the 25 current sites are [inventories.md](./inventories.md) §3g). Confirms
  become the will-phase dialog (§1) or an inline two-step (click → confirm
  button state) for small in-pane destructions like note deletion.
- **Loading/error states**: `QueryGate` renders three states consistently —
  skeleton/spinner (loading), content (data), and an inline error block with
  a retry button (error). "Loading…" forever is the bug it exists to kill;
  no pane hand-rolls its own `<Show>` fallback chain after its file is
  otherwise touched.

## 6. Agent visibility and control (agent-runtime §3, Phase 3's WS)

- **Cancel is a first-class row action** in the agents panel: cancel-run on
  the run header, kill-step on a running step. Both are immediate,
  no-confirmation actions (the will-phase pattern is for *destroying user
  state*; stopping an agent is recoverable — the persisted steps remain).
  A cancelled run renders distinctly from a failed one.
- **Running steps show a live tail** once the WS carries
  `workflow:step:event` frames: last few stream lines under the step row,
  monospace, auto-following. Absence of output for >30 s shows a quiet
  "no output" hint rather than nothing (a hung step and a quiet step look
  different).
- The panel updates on push (`notify` → `onStatus`), so state changes appear
  without the 3 s poll delay — cancellation reflecting instantly is what
  makes the button feel trustworthy.

## 7. Pane management — modern expectations (Phase 5)

The pane row must behave like panes in a modern IDE or terminal: resizable,
pinnable, maximizable. Today it is none of these — slots are strictly
equal-width (`flex: 1 1 0`, `task-view.css:215`), the model has no size field
at all (`layout.ts:11-13`), and maximize exists only for the terminal drawer.
The drawer is the in-house precedent for all three concerns — pointer-drag
resize clamped and persisted (`TerminalPanel.tsx:161-173`), focus-directed
⌘⇧⏎ maximize (`App.tsx:79-100`), session-only max state (`tasks.ts:80-92`) —
and this section generalizes its patterns to the row rather than inventing new
ones. This work rides the Phase 5 pane-registry slice: the registry rebuilds
pane hosting anyway, so the host grows these behaviors once, for every pane,
rather than per-pane later.

**What stays deliberately flat**: the left→right single row. No split trees,
no vertical splits within the row (the terminal drawer *is* the vertical
dimension), no tab stacks, no floating/detached panes. Everything below is
expressible on the flat model, and `normalizeLayout`'s defensive versioning
keeps a future tree migration open — this is not a one-way door.

- **Resize.** A drag divider between every pair of adjacent slots, adjusting
  only the two neighbors' relative weights (VS Code semantics, not a cascade).
  Weights persist per task inside `task_layouts` (T3,
  [state-and-policies.md](./state-and-policies.md) §5.1). Minimum pane width
  240 px by default; a pane contribution may declare a larger `minWidth`
  ([contribution-points.md](./contribution-points.md) §4.1). Double-click a
  divider equalizes all weights. Dragging tracks the pointer at frame rate;
  Monaco/xterm refits coalesce to at most one per frame
  ([performance.md](./performance.md) §2).
- **Pin.** A pinned pane survives `show`: the switcher's show action replaces
  only the *unpinned* panes, so a pinned editor or preview stays put while the
  user flips the rest of the row — this is what pinning is *for* in a
  one-row model. The ✕ on a pinned pane unpins first (guarded close, the
  pinned-browser-tab convention); a second ✕ closes. Pin state persists with
  the layout (T3). The affordance rides the existing per-slot close control
  plus palette rows ("Pin pane: X"); pinned slots show a small glyph. Note
  the legacy `{ active, pinned[] }` persisted shape that `normalizeLayout`
  still parses (`layout.ts:70-82`) is exactly this semantic returning — the
  migration path is already in-tree.
- **Full view / maximize.** ⌘⇧⏎ generalizes from "maximize the drawer when a
  terminal is focused" to "maximize the focused surface": a focused pane fills
  the row; the underlying weights and pane set are untouched. Toggle again,
  Esc, or showing another pane restores the row. Maximize is session-only
  (T4) — relaunch restores the row, never the zoom — and lives beside the
  drawer's `terminalMaxTasks` session state, not in `TaskLayout`. All chords
  keep working while maximized (invariant, §8).
- **Reorder.** A `move` action in the reducer, driven by palette rows ("Move
  pane left/right") and chords. Pointer drag-to-reorder is deferred: slots
  have no header to grab, and the keyboard path covers the need; the task
  rail's DnD (`TabRail.tsx:261-266`) is the precedent if it's wanted later.
- **The model.** `TaskLayout` grows `weights?: Partial<Record<PaneId, number>>`
  and `pinned?: PaneId[]`; the reducer gains `resize`, `pin`, and `move`
  actions (maximize is T4 session state, not a layout transition). Weight is
  keyed by pane id, not by array index, so reorder and unknown-id filtering do
  not silently attach a width to the wrong pane. Absent weights mean equal
  share among currently visible panes; stale weights for hidden/unknown panes
  are retained but inert, matching the existing unknown-pane policy. `close`
  removes the visible slot but keeps its stored weight for future reopen;
  `show` adds panes with default weight unless a stored weight exists;
  `resize` clamps the two affected panes to their min widths and normalizes
  only the visible pane set for rendering. Every persisted layout stays valid
  with no migration. The reducer stays pure and keeps its test file — every
  new action lands with cases in `layout.test.ts`, including close→reopen,
  reorder, unknown ids, and min-width clamping.
- **Focus and accessibility.** Pane focus is core-owned: clicking inside a pane
  marks it as the focused surface for maximize and move commands, but panes do
  not read or write global focus state directly. Dividers are keyboard
  reachable separators with left/right resize commands; pointer drag captures
  the pointer until release and must not steal text selection inside Monaco or
  xterm.

## 8. Invariants the refactors must not regress

These are the UX properties the current app gets right; every phase's manual
verify pass includes them implicitly, and the budgets make three of them
measurable ([performance.md](./performance.md) §2):

- **Keyboard-first everything**: any new surface (dialogs above included) is
  fully keyboard-operable; chords keep working while it's open or it closes
  on Esc.
- **Pane switch ≤ one frame; task switch ≤ 100 ms** — registries add lookup
  indirection, not render weight.
- **Terminal echo ≤ 50 ms p95** through the WS migration; a busy TUI never
  visibly tears or stalls (coalescing must be imperceptible, not merely
  efficient).
- **Degraded, never broken** (tenet 6): a disconnected integration hides its
  source; an unknown persisted pane id is inert; a throwing pane shows a
  contained failure card, and the rest of the shell keeps working.
- **Restore is exact**: relaunch lands the user where they were — workspace,
  task, source, layout (pane set, order, id-keyed weights, pins), editor tabs —
  byte-for-byte with today's behavior (smoke test S2 pins it).
- **No new chrome**: the plugin model must be invisible. If a user can tell
  the app was re-architected, something leaked.
