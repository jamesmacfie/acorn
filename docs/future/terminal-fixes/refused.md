# Refused: the paths not taken, and why

2026-09-01. Argue with the reasoning, not with silence.

## For the rendering fix

**`startTransition` around `navigate` as the fix.** A transition keeps prior content rendered while
the next resolves, so the visible symptom goes away for navigations — and only for navigations. The
browse window sliding onto uncached rows mounts queries with no navigation anywhere, and so would
any future state write; every one is another hole to wrap. Worse, it masks the destroy rather than
repairing it: the dead-node mechanism stays armed for whoever suspends next. Kept as UX polish over
a correct base (rendering-lifecycle.md § Not done), refused as the fix.

**A TUI-safe `Suspense`.** A boundary of our own that hides instead of unmounting would only cover
boundaries we author. `GithubBrowse.tsx` imports `Suspense` from `solid-js` — plugin code, shared
with the desktop — so intercepting it means aliasing solid-js itself, a far bigger seam than the
reconciler alias, to fix a problem that lives in the reconciler's half anyway.

**Non-suspending query reads.** Guarding `.data` behind `isSuccess` (or a helper) in the consumers
means TUI-only rules inside shared plugin code, where `Suspense` is fine on the DOM. Refused
outright: the host contract is that a plugin renders on both hosts from one source.

**Patching `@opentui/solid` via pnpm.** The dist is a 47 KB bundle shipped twice (`index.js`,
`index.bun.js`); the repo patches no packages today, and the alias already sits in front of every
call the transform emits — in-repo, typed, reviewed. Same interception, none of the costs. The
right upstream move is an issue, not a patch.

## For the interaction model

**`model` on `SourceContribution` now.** Panes have exactly this seam (`PaneLayoutContribution.model`,
one root per pane and task) and the symmetry is tempting. But every current source's cross-region
state is an address, and the URL plus the query cache carries it; github's `createBrowseScope()` is
the sanctioned shape for shared *derivation*. Building the seam now is machinery with no consumer.
The trigger is written down instead: the day a source's halves must share state that cannot be an
address — multi-select, a transient filter both halves read, or the TUI growing a real query string
(`PullDetail`'s `?file=` is detail-internal today and merely inert here) — add
`model?: () => M` created once per source mount, both regions taking `{ model }`, exactly as panes
do. This is a deliberate exception to "build the seam anyway": that rule buys contract design when a
second consumer is plausible; here the second consumer's *need* is what does not exist yet.

**A dedicated key for region movement.** New chords for rail↔main were considered and dropped:
`right`/`left` already carry the `expand`/`collapse` intents and the layer ladder already lets them
bubble from a list that cannot expand. Spending the bubbled key costs nothing to learn (it is what
lazygit readers already do) and no new keymap rows.

**Wrapping the spatial move.** `right` at the main pane wrapping back to the rail was rejected: a
no-op at an edge is information (you are at the edge), a wrap is disorientation, and Tab already
provides the full cycle for whoever wants one.

**Registering home/fleet in the TUI.** They are desktop landing surfaces; the TUI opens on a task
and its task list is the rail's third panel. Registering them is a product decision about what a
terminal landing surface should be, not a gap — taking it incidentally inside a fixes programme
would decide it by accident.

**Hiding the Browse panel for component-only sources.** Collapsing the frame when a source has no
list would reflow the whole left column on every Menu move. The frame stays (a panel is a place on
the screen); only its focus registration goes.
