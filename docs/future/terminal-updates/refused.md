# Refused

2026-09-02. What this programme decided not to do, with the reasoning, so a later session argues with
the reasoning rather than with silence. The first block carries forward the refusals of
`docs/future/terminal-fixes/` (deleted 2026-09-01, in git history), because they still hold and
nothing here reopens them.

## Carried forward from terminal-fixes

**A dedicated key for rail-to-main.** `→`/`l` and `←`/`h` already carry `expand` and `collapse`, and
the layer ladder lets them bubble from a list that cannot expand. The bubbled key costs nothing to
learn and adds no keymap row.

**Wrapping the column move.** A no-op at an edge is information. A wrap is disorientation, and Tab
is the full cycle for whoever wants one.

**A `model` on `SourceContribution`.** Every source's cross-region state is an address the path
carries. The trigger for adding one is written there: multi-select, a transient filter both halves
read, or a real query string on this host.

**Hiding the Browse frame for component-only sources.** A panel is a place on the screen. The frame
stays; only its focus registration is conditional.

## Refused in this programme

**A second keymap, a key handler in a component, or a vim mode.** `docs/tui.md` § What must never
happen already refuses all three, and every phase here is expressible as intents on the existing
tiers. `j`/`k`/`h`/`l` are letters bound to intents in one table, which is as much vim as this host
has, and it is enough.

**Making the focus store a Solid store or a reducer.** The temptation once `regions.ts` is opened is
to rebuild it as an immutable state machine with actions. The store is small: one focused
renderable, one region ref, a list of groups, a remembered identity per group, and a provisional
flag. What was wrong was not its shape but that six pieces of code wrote to it at six deferred
moments. One settle pass fixes the timing. A reducer would fix nothing and cost a rewrite of every
caller.

**Focus roles set by the plugin.** A plugin might want to say "this `Text` is a stop". Refused as
`focusRoles.ts` refuses it: the role is the node's, fixed by the kit, on both hosts. A plugin that
needs a stop draws a node that is one.

**A per-node `tui` behaviour flag in the support matrix.** Adding a column like `presses: true` to
`support.ts` would let the table describe the gap instead of closing it. The table already says
`Button` is `full` on this host, and the fix is to make that true, then pin it with a behaviour test
per node (phase 0), not to add a row that admits it is false.

**Scroll-then-jump inside a document.** Inside a panel with stops, `↓` moves to the next stop and
reveals it, skipping the text between. A hybrid where `↓` scrolls line by line until the next stop
is on screen and then lands on it was considered. It makes `↓` mean two things depending on scroll
state, which is the kind of rule a footer cannot explain in one word. Page keys scroll, arrows move
between stops, and a document with no stops keeps arrows for scrolling. Revisit if readers of long
descriptions ask for it, and if so make it a device preference rather than the default.

**Escape wrapping to the rail from anywhere in one press.** A single Escape from deep inside a panel
that teleports to Browse is fast but loses the strip the reader came through, and the next Enter
would not know where to return to. Escape climbs one level. The bound is `depth + 1` presses and
depth is one or two on every first-party surface.

**Making `PaneStrip` a parent stop.** The task-pane strip looks like a `Tabs` strip and is not one:
its panels are whole panes with their own regions, and Down from it already goes to the next region.
Treating it as a parent would put the pane's regions under the strip and change what Tab means for
the whole pane. It stays a region of its own.

**Inventing a `Toolbar` collection.** A row of buttons could rove like a `SegmentedControl`. Then
`↓` from a strip would land on the toolbar as one stop and `→`/`←` would move inside it, which
collides with `→`/`←` meaning "cross to the rail" one level up and "choose a tab" one level down. A
toolbar's buttons are plain stops in reading order, reached with `↓`/`↑`. `focusRoles.ts` already
says `Toolbar` is `none`.

**Drawing the `rows` extension kind as a footer strip.** `pane.footer` rows on the desktop are a
strip of buttons under the pane. In cells that is one more row of chrome on a 24-row screen. Phase 5
draws them as a `Rows` collection at the end of the owning region instead, which is reachable and
costs nothing when empty. If a plugin's footer turns out to need pinning, that is a `header-body-footer`
footer region, which exists.

**Host UI slots (`overlay`, `drawer`, `topbar.*`) on this host in this programme.** The terminal's
overlays are a fixed set drawn by the shell, and the drawer is the rail. Giving plugins those slots
is the client-plugins programme's replaceable-surfaces phase
(`docs/future/client-plugins/04-replaceable-surfaces.md`), which owns the contract for both hosts.
Phase 5 makes the loss explicit in `docs/tui.md` and stops there.

**The `rectangle` extension kind.** An iframe beside a pane. Still absent, still one muted line
naming the point. Unchanged from `docs/tui.md` § Rectangles.

**Mouse beyond click-to-focus and wheel.** Unchanged. A control that becomes a stop in phase 0 also
gets `onMouseDown` for free through the same helper, because a click is a focus followed by a press
and both already exist. Hover, drag, and context menus stay out.

**Fixing the desktop's `ExtendedPane` mount for loaded panes here.** Finding 9 in
[analysis.md](./analysis.md) names a DOM component mounted on this host. The fix is a host seam in
client-core, the same shape as `setLayouts`, and phase 5 adds it. Patching around it in `apps/tui`
by filtering the contribution before it reaches the frame registry was refused: the seam is what the
other three of its kind already are, and a filter would be a fourth way to say "this host cannot".
