# Phase 3: one kind of tab strip, and chords the terminal can press

Shipped 2026-09-02. [docs/tui.md](../../tui.md) § Focus regions owns which strips are parent stops
and how a strip finds its panels, and
[docs/command-palette-and-shortcuts.md](../../command-palette-and-shortcuts.md) § Pane shortcuts
carries the Ctrl spelling of the pane chords.

A `TabPanel` registers its own box under the `idPrefix` it already carries, and `Tabs` reads the set
under the same prefix, so a strip is a parent whoever drew it. Linear, Rollbar, Docker, the HTTP panes
and the editor's side strip gained strip-then-Down with no plugin change. `DocumentTabs` is a
horizontal collection rather than a parent. `apps/tui/src/invariants.test.ts` now refuses the
platform's primary modifier anywhere under `apps/tui/src` but the rewrite in `keys/commandLayer.ts`
that removes it.

## Where the design changed, and why

Two requirements did not survive contact.

1. **There was no `entry` prop to delete.** Requirement 1 was written against a `Tabs` that took one;
   the strip took a `panels` getter instead, which `Sections` and the `tabs` layout filled from a map
   of their own. Same finding, one word different: a prop only the two first-party callers could pass
   is why a plugin's strip behaved differently. The getter is gone and the prefix map replaced it.
2. **There is no Linear fixture case.** The phase asked for one in `panes.test.tsx` or
   `browse.test.tsx`. Nothing Linear is wired into this host's fixture — no connection, no source, no
   issues — so the case would have been a Linear integration first and an assertion second, and the
   assertion is the one two `kit.test.tsx` cases already make against the mechanism every plugin
   shares: a `Tabs` with two sibling `TabPanel`s enters on the strip, Down reaches a control in the
   showing panel, and Escape comes back; a `Tabs` with none beside a `Rows` leaves the caret on the
   first row. Requirement 5 holds by pairing, and the pairing is what is tested.
