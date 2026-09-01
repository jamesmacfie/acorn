# Phase 5: what a plugin's extension reaches in cells

Shipped 2026-09-02. This file is a pointer and a record of where the design changed on contact.

## Where it lives now

[docs/tui.md](../../tui.md) § What a plugin loses here is the table this phase existed to write: one
row per cooperative extension kind and per host UI slot, what each host does with it, and where the
answer lives. § Loaded plugins § Reserved regions holds the `ExtendedPane` seam beside the
source-panel one. [docs/plugins.md](../../plugins.md) § Cooperative extension points names the
terminal behaviour of each of the five kinds and points at that table.
[docs/plugin-authoring.md](../../plugin-authoring.md) § `keybindings` says what a reader presses.
[docs/first-party-plugins.md](../../first-party-plugins.md) § What each of these loses in a terminal
says which of these panes gained something.

The code is `packages/client-core/src/host/chrome/extendedPane.ts` (the seam),
`apps/tui/src/plugins/ExtendedPane.tsx` (this host's answer), `apps/tui/src/kit/host.tsx`
§ `ExtensionRows`, and `apps/tui/src/kit/showing.tsx` § `AnnotatedDiffLine`. The tests are
`apps/tui/src/extensions.test.tsx` and the reserved-regions case in
`apps/tui/src/plugins/plugins.test.tsx`.

## Where the design changed

**The seam has no default, and the DOM component was renamed.** Requirement 1 asked for
`setExtendedPane(component)` and "a default that returns the DOM `ExtendedPane`". It has the shape its
three siblings have instead: `suppliedExtendedPane()` answers `null` and `frames/register.ts` falls
back to its own `lazy` import, which is what `layouts/table.ts`, `tree/table.ts` and
`chrome/sourcePanel.ts` all do. A default inside the seam would put a component behind a module the
bare-Node suites import for its types. The DOM component also moved from
`host/chrome/ExtendedPane.tsx` to `host/chrome/ChromeExtendedPane.tsx`: two files whose names differ
only in the first letter are one file on a case-insensitive filesystem, and `tsc` refuses the program.
The name matches `ChromeSourcePanel.tsx` beside it.

**A mark goes under its line, not at the end of it.** Requirement 7 said "at the end of a line that has
any". Written that way it is invisible: a diff line is `wrapMode="none"` and as wide as the patch, so
anything after it is past the frame and clipped. It draws on the line below instead, indented past the
gutter — which is also where the DOM puts it, inside the row's own measured height (`lineExtra`), so
the two hosts agree rather than differ.

**`asCtrl` needs no dedupe.** Requirement 13 asked what `@opentui/keymap` does with a repeated
modifier. Its parser reads each part into a boolean, so `ctrl+ctrl+meta+shift+d` is `ctrl+meta+shift+d`
and nothing is owed. `apps/tui/src/extensions.test.tsx` presses a fixture plugin's
`meta+ctrl+alt+shift+d` and asserts the command runs.

**There is no `chrome/slot.tsx` test to confirm.** Requirement 10 asked to check that the existing one
covers a replacement drawing `Rows`. There is none. The requirement's own answer is that the exclusive
slot needs no change, and what it wanted asserted — that a `Rows` inside it is reachable — is a claim
about `Rows`, which every list case in the suite makes. No test was added for a seam nothing changed.

**The fixtures live beside `fixture.ts`, not in it, and the harness installs them.** Requirement's file
list said `apps/tui/src/fixture.ts`. That file is the fixture *node* and has no JSX in it, and a
`component` carrier is a component. They are `apps/tui/src/fixtureExtensions.tsx`, installed from
`harness.tsx` with the other per-render resets rather than from `App.tsx`: a composition root runs once
per worker, so the second case in a file would inherit the first case's flags.

**The harness now clears the annotation store.** Not a requirement, and the reason the diff case failed
for an hour. `requestAnnotations` remembers which key set it has already asked about, and that memory
is module state — so a render whose fixture contributes marks was handed the previous render's empty
answer and never asked. It sits with `_resetCollections` and the rest.

**`contributionKinds.test.ts` gained no terminal column.** Requirement's test list made that
conditional on the file listing each kind's carriers. It does not: it checks that
`docs/contribution-kinds.md` names every manifest key and every `ctx` member. The terminal answer per
kind is in `docs/tui.md`'s table, which is prose a checker cannot hold a kind against.

**The badge cases are their own file.** They were written for `panes.test.tsx` § github. Each needs an
environment flag set before the composition root runs, and the query cache outlives a render, so they
are `apps/tui/src/extensions.test.tsx` for the reason `browseLong.test.tsx` and `diffLong.test.tsx` are
their own files.
