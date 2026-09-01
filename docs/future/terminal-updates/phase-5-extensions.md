# Phase 5: what a plugin's extension reaches in cells

Design, 2026-09-02. Not started. Depends on phase 0 (a contributed `Button` is a stop) and phase 2
(stops inside documents are reachable). Independent of phases 3 and 4.

## Goal

Every cooperative extension kind in `docs/plugins.md` § Cooperative extension points either draws
and is reachable by keyboard on this host, or is named in `docs/tui.md` as a loss with a reason. A
loaded plugin that declares a `pane.footer` or `pane.aside` point does not hand the cell reconciler
a `<div>`. The diff annotation points deliver. The doc sentence "Nothing, from the plugin author's
side" becomes true or is replaced by the table.

## Why

[analysis.md](./analysis.md) finding 9. The remote tree slot and the exclusive slot cross with full
parity because each got a host seam. Three kinds got none: `rows` has no counterpart, the dashboards
`pane.aside` region has none, and host UI slots have none. One of those is a crash: the desktop's
`ExtendedPane` is mounted around a loaded plugin's pane on this host. And the annotation kind is
half-crossed: marks draw, but `DiffPane` drops the prop that names the point.

## Requirements

### The seam

1. `packages/client-core/src/host/chrome/extendedPane.ts` (new) is a host seam of the same shape as
   `host/layouts/table.ts` and `host/chrome/sourcePanel.ts`: `setExtendedPane(component)` and a
   default that returns the DOM `ExtendedPane`. `host/frames/register.ts` reads the seam instead of
   importing `ExtendedPane` directly.
2. `apps/tui/src/plugins/ExtendedPane.tsx` (new) is this host's, installed from `apps/tui/src/App.tsx`
   beside `setLayouts`, `setRemoteTree`, and `setSourcePanel`. It draws the pane, then the footer
   rows (requirement 4), and names the aside (requirement 6).

### Rows

3. `apps/tui/src/kit/host.tsx` exports `ExtensionRows(props: { point, ... })`, the counterpart of
   `host/chrome/ExtensionPointHost.tsx`: it reads the same registry and draws each delivered row as
   a `Row` in a `Rows` collection with `onActivate` running the row's action. The collection is
   reachable because `Rows` is, and it sits at the end of the owning region in reading order.
4. This host's `ExtendedPane` draws `ExtensionRows` for `pane.footer` under the pane's own tree, not
   as a pinned strip. See [refused.md](./refused.md) § Drawing the `rows` extension kind as a footer
   strip. When the point has no deliveries the collection draws nothing and registers no stop.
5. A compiled first-party pane that hosts `pane.footer` today through the DOM `ExtendedPane` gets
   the same rows on this host through the same seam; nothing in a plugin changes.

### Aside

6. `pane.aside` is the user's dashboard region, drawn by `PanelGrid` on the desktop. It is not
   drawn here in this phase: one line naming the point, the same answer `InlineSlot` gives. Dashboards
   in cells are the dashboards programme's question (`docs/future/dashboards/README.md`), not this
   one's. The loss is written into `docs/tui.md` § What a plugin loses here.

### Annotations

7. `apps/tui/src/kit/showing.tsx` § `DiffPane` reads its `annotations` prop: it calls
   `requestAnnotations` for the visible rows with the key shape the point declares (`file`, `line`,
   `side` for `github:diff-line`) and draws `AnnotationMarks` at the end of a line that has any. The
   DOM's `features/diff/DiffPane.tsx` is the reference for when to request and what to key on.
8. A mark is text. It is not a stop and it does not change the diff's focus behaviour. A per-line
   comment control, if one arrives, is a stop under phase 2's rules; nothing here adds one.

### Slots a plugin fills

9. The remote `Slot` in `kit/host.tsx` needs no change. Confirm with a test that a fixture
   contribution drawing a `Button` inside `github:summary-badges` is reachable with `↓` from the
   Details strip and pressable, and that a fixture contribution drawing only `Text` is not a stop and
   does not break `↓` past it. This is the keyboard contract for extension content: as reachable as
   the kit nodes it draws, inside the region its host registered.
10. The exclusive slot `rail.taskList` needs no change. Confirm the existing `chrome/slot.tsx` test
    covers a replacement that draws `Rows`.
11. `InlineSlot` (the `rectangle` kind) stays one muted line. Unchanged, by `docs/tui.md`
    § Rectangles.

### Host UI slots

12. `overlay`, `drawer`, `task.footer`, `task.switcher.extra`, and `topbar.*` are not drawn on this
    host in this phase. They are the client-plugins programme's replaceable-surfaces question for
    both hosts (`docs/future/client-plugins/04-replaceable-surfaces.md`). The five first-party
    registrations that draw nothing here are listed in `docs/tui.md` § What a plugin loses here with
    a pointer to that phase.

### Chords

13. A loaded plugin's manifest chord is `meta+ctrl+alt+shift+key` on the desktop. On this host it
    passes through `commandLayer.ts` § `asCtrl`, which rewrites a leading `super+` to `ctrl+`, so the
    result carries `ctrl` twice. Check what `@opentui/keymap` does with a repeated modifier; if it
    refuses or misparses, `asCtrl` dedupes the modifiers. Then confirm with a test that a fixture
    plugin's command chord fires here, and write the spelling a terminal reader presses into
    `docs/plugin-authoring.md` § Keybindings.

## Design notes

**Why the seam and not a filter.** [refused.md](./refused.md) § Fixing the desktop's `ExtendedPane`
mount. Three seams of this shape exist and this is the fourth; a filter in `apps/tui` would be a
second mechanism for "this host draws its own".

**Why rows are a collection and not a toolbar.** Rows are what the kind is called and what the
desktop draws, and a `Rows` is the one thing on this host every reader already knows how to drive.

**Why the aside waits.** A dashboard is a grid of panels sized in pixels. Its terminal projection is
a design, not a port, and it belongs with the dashboards programme.

## Files

- `packages/client-core/src/host/chrome/extendedPane.ts` (new), `host/frames/register.ts`.
- `apps/tui/src/plugins/ExtendedPane.tsx` (new), `apps/tui/src/App.tsx`.
- `apps/tui/src/kit/host.tsx`: `ExtensionRows`.
- `apps/tui/src/kit/showing.tsx` § `DiffPane`.
- `apps/tui/src/fixture.ts`: a fixture remote contribution into `github:summary-badges` drawing one
  `Button`, and a fixture `pane.footer` delivery, both behind a flag the way
  `ACORN_FIXTURE_SECOND_WORKSPACE` is.
- `docs/tui.md` § What a plugin loses here, `docs/plugin-authoring.md` § Keybindings.

## Tests

- `apps/tui/src/plugins/plugins.test.tsx`: a loaded plugin pane declaring `pane.footer` mounts
  without "Unknown component type" and its rows are drawn and activatable.
- `apps/tui/src/panes.test.tsx` § github: with the fixture badge contribution on, `↓` from the
  Details strip reaches the contributed button; with the text-only contribution on, `↓` skips it.
- A `DiffPane` case: with a fixture `github:diff-line` annotation on, the marked line shows the mark
  text at its end.
- `tools/arch/contributionKinds.test.ts`: if it lists each kind's two carriers, add the terminal
  column so a kind cannot be added without a terminal answer, even if the answer is "named as lost".

## Acceptance

- Requirements 1 to 13 hold.
- `docs/tui.md` § What a plugin loses here is a table: kind, desktop, terminal, and where the
  terminal answer lives or why it is absent. The sentence "Nothing, from the plugin author's side"
  is gone.
- `pnpm lint`, `pnpm --filter @acorn/client-core test`, and `pnpm --filter @acorn/tui test` are green.

## Doc moves when it ships

`docs/tui.md` § Loaded plugins gains the `ExtendedPane` seam beside the source-panel one.
`docs/plugins.md` § Cooperative extension points gains one sentence per kind naming the terminal
behaviour, pointing at `docs/tui.md`. `docs/first-party-plugins.md` § What each of these loses in a
terminal is checked against the new table. This file shrinks to a pointer.
