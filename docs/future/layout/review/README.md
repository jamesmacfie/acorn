# Review of the layout programme, and what is left before the folder can go

Reviewed 2026-08-30 against commit `4dbbecf3` (phase 9). Every phase file was read, every open
comment in them was checked against the code, and every row of [docs-migration.md](../docs-migration.md)
was checked against the doc it names.

Two phases remain, and they are sequenced so the folder is deleted at the end of the second:

| Phase | File | What it delivers |
| --- | --- | --- |
| 10 ✅ | [phase-10-finish-the-implementation.md](./phase-10-finish-the-implementation.md) | The code the phase files say shipped but did not, one scoping gap, the missing tests, and the two decisions. Shipped 2026-08-30; its "what shipped" section records six places it differs from what this review expected |
| 11 | [phase-11-rehome-the-design-and-delete.md](./phase-11-rehome-the-design-and-delete.md) | Move the design content that lives only in this folder into owning docs, fix the stale sections, repoint 70 inbound links, delete `docs/future/layout/` |

Phase 10 changed three things this review says below, and the phase file's own record wins where they
disagree:

- **`terminal:before-run-target` was never dead.** `runtime.ts` has called it since phase 4. The
  finding under "Still open, and code" is wrong; what was owed was a test.
- **The region seam was built**, with the `model` key on a pane contribution, and the four hand-rolled
  root maps are gone. The API pane moved to `list-detail`; linear and rollbar did not, because their
  split is conditional on a task linking more than one item and a manifest cannot express that.
- **`core:task` is a rail marker**, not an `AnnotationMarks` draw site. `editor:line` and `editor:path`
  are struck from the docs.

## Verdict against the six goals

| Goal | Verdict |
| --- | --- |
| 1. A plugin lets other plugins draw inside it, host-carried, both sides in the trust prompt | Built. `Slot`, `resolveSlot`, provenance frame, trust copy per kind and direction. Exercised by two first-party contributors (`changes` on `agents:tool-card`, `memory` on `context:section`). No third-party contributor has run through it outside tests. |
| 2. Five extension kinds | Built unevenly. `hook` is the strongest: runner, 12 declared points, eight chains called. `remote` is complete. `annotation` is complete as a mechanism with three draw sites and zero contributors. `rows` has a host and zero first-party declarers. `rectangle` is plumbed end to end with zero declarers, no client-side test, and the cross-box `slot.call` and `slot.on` channel from 08-hooks.md was never built. |
| 3. A closed kit with semantic props | Built and enforced. 70 nodes in `NODE_SUPPORT`, every `tui` cell filled, a type-level test that refuses `class` and `style`, zero raw `div` or `span` in any plugin. |
| 4. Layouts are the host's | Built, with a design consequence nobody planned for. Half of the 14 layout-declaring surfaces are `single`, because two regions are two renderers and the host gives them no way to share state. Four compiled plugins hand-rolled the same per-task `createRoot` map. See "The one open design question" below. |
| 5. Focus and keys for free | Built. `@opentui/keymap` installed, 18 intents, region groups on every layout, collection state keyed by identity, `runtime:focus-changed`, the cheat sheet. Two of the five promised tests are missing. |
| 6. Plugins as interceptors | Built. One handler exists in the repo (`terminal` on `core:worktree-created`). |

The constraint "the desktop app must work as it did" is unverified. The smoke checklist has never
been run for any phase, and every phase file says so. That is the owner's part of phase 9 and it is
still owed.

## What the phase files say is open, and what is actually open

The phase files carry 26 "owed" or "not done" comments. Checked one by one:

**Closed by a later phase, nothing to do.** Phase 0's `adoption.test.ts` ledger (inverted in phase 9).
Phase 1's leftover `Drawer.tsx` (a host component since phase 9). Phase 3's `--remote` template
default (tree is the default; the flag is `--rectangle`). Phase 4's `agentToolRendererRegistry` still
winning (deleted in phase 9). Phase 6's `terminal.css` (deleted in phase 9). Phase 7's
`_resetCollectionState` merge bug (it replaces the store, `collectionState.ts:45`). Phase 8's
`agents:tool-card` declaration (declared in `plugins/agents/src/client/index.ts:42`).

**Still open, and code.** These go to phase 10:

- `terminal:before-run-target` is declared, appears in the trust prompt, accepts handlers, and is
  never run. `plugins/terminal/src/main/runIpc.ts:52` forwards `hooks` into `createRuntimeService`
  through an object spread, and `plugins/terminal/src/main/runtime.ts` never reads it. The spread
  bypasses the excess-property check, so the compiler could not tell.
- A remote tree mounted in a slot has no task or project. `Slot.tsx:75` mounts `RemoteTree` without a
  `scope`, so `binding.taskId` is `undefined` and `openPane`, in-app `openUrl`, and task-scoped key
  bindings are inert (`frameServices.ts:117-170`). Phase 3 deferred this to phase 4 as "where a slot's
  scope gets designed"; phase 4 did not design it. The rectangle kind (`InlineSlot.tsx:61`) does pass
  the subject, so the two kinds disagree.
- Three of the six annotation draw sites from phase 4 are unbuilt: `editor:line`, `editor:path`, and
  `core:task`. Phase 4 said phases 6 to 8 would land them "anyway"; they did not, and phase 9
  converted the editor without adding either editor point. `docs/future/rail-tab.md` says slice 3 is
  superseded by `core:task`, which does not exist.
- `KeyValueEditor` has no row roving focus (phase 2 deviation 4 owed it "when something asks").
- The phase 4 "done when" test plugin declaring all five kinds was never written.
- Two layouts read `window.innerWidth` (`DocumentSplit.tsx:49`, `ListDetail.tsx:39`) against the
  rule in `shell.css:112` and 05-layouts.md that no layout reads the window width. Both are drag
  clamps and neither re-evaluates on resize.
- `keys/install.ts:11-17` documents a priority-20 pane layer that nothing registers.
- The arch rule for plugin CSS bans shipping a `.css` file, not importing one. Two plugins import
  `@xterm/xterm/css/xterm.css`, which is fine, but the rule as described in phase 9 does not exist.
- Tests promised in 07-focus-and-keys.md and phase 2 that do not exist: `nextRegion` round-trips
  every layout (only `list-detail` is walked), every kit node operable with hover disabled (no test
  mentions hover), `role="tree"` and `aria-modal` asserted (implemented, not asserted).
- No plugin package can render a Solid component in a test. Phases 7 and 8 both deferred "a jsdom
  project in the plugin" to phase 9, and phase 9 did not answer. Every region component a plugin
  ships is untested where it lives.

**Still open, and docs.** These go to phase 11. The short version: four bodies of design content
have no owning doc (the 80×24 sentence per node, each layout's narrow and terminal projections, the
tree wire format, the refused arguments and the "never do these" list), three owning-doc sections
still describe the frames-only world, and 70 files link into this folder.

**Manual, owner's.** `docs/testing.md` smoke items 23 to 25 and the full checklist. Listed on
`docs/next-review.md` § Verification already. Not repeated in a phase file.

## Is the architecture sound

Yes, in the parts that carry load. The boundaries the design promised are the boundaries the code
has: the kit is closed by type and by test, the wire refuses functions and classes, the worker gets
its own origin and CSP, hooks run node-side with the same timeout and validation shape as the design,
and focus is one engine with one catalog. The deviations recorded in the phase files are mostly
findings, not shortcuts, and `ListDetail` staying a kit node is the clearest example: a split inside
a region is a different object from the pane's outer arrangement.

Three things to name.

**Plugin-declared point ids live in plugin code.** `changes:diff-line`, `github:diff-line`,
`docker:container`, and `context:section` are declared in the owning plugin's `extensionPoints.ts`,
while `agents:*` and `core:*` are in `@acorn/protocol`. Both are defensible. What is not defensible
is that a contributor in another plugin has to spell the string, because a plugin may not import
another plugin. Either every first-party point id moves to protocol, or the rule "the owner's
module holds the id and contributors spell the string" is written down. Phase 11 writes the rule.

**`Grid`, `DiffPane`, and `KeyValueEditor` are `collection` in `focusRoles.ts` and do not use the
collection store.** `Grid` moves `selected` through its own prop (phase 2 deviation 3, a deliberate
choice for a virtualised list). The focus table says one thing and the store says another. Phase 10
either gives them a distinct role or notes the exception in the table.

**Regions have no shared-state seam.** Covered below, because it is the one place a decision is
needed rather than a fix.

## The one open design question

The design said a pane picks a layout and fills regions. Seven of 14 layout surfaces picked
`single` and drew their own split inside it, and the reason is stated in
`plugins/http/acorn-plugin.config.mjs:79-81`: two regions are two renderers with no way to hold one
signal between them. The four compiled panes that did use `list-detail` each solved it the same way,
a module-level `Map<taskId, createRoot>` (`notesModel.ts:38`, `changesModel.tsx:31`,
`agentPaneModel.ts:36`, `contextModel.ts:26`). Loaded plugins have no equivalent, which is why every
loaded pane except `database` is `single`.

This matters for goal 4 only if the narrow projection is ever built. A `single` pane with a
`ListDetail` inside it cannot become one region at a time from the host's side. If the PWA is real,
the host needs to own those splits.

The recommendation is to add the seam, because four copies of the same thing is the admission rule's
own test ("two or more plugins need it"), and it deletes code rather than adding it:

```ts
ctx.panes.register({
  id: 'notes', layout: 'list-detail',
  model: (task) => createNotesModel(task),      // created once per task, disposed on eviction
  regions: { list: NotesList, detail: NoteBody }, // each region receives { task, model }
})
```

For a loaded plugin the equivalent is one worker entry that answers `mount` for every region with
the same module state, which `mountTree({ list, detail })` already allows. The http config's comment
would then be wrong, and http, linear, and rollbar could move to the layouts the survey named.

If the owner decides the narrow projection is not coming, the alternative is cheaper: strike the
narrow projection from the docs, accept `single` as the common case, and say in `docs/panes.md` that
a split inside a region is the plugin's. Phase 10 carries the seam as an optional item so the
decision is visible and not made by default.

## Readability

The folder is well written and too long to keep. 4,110 lines, of which about 1,500 are "what
shipped, and where it differs" sections that repeat each other: the README's eight deviations are
phase 9's eight departures word for word, and phase 6's deviation 9 is restated in phases 7 and 8.
That duplication is what phase 11 collapses when the surviving facts move to owning docs.

Specific problems:

- The layout count drifts. 05-layouts.md says six, `layouts/regions.ts` and the test say seven,
  `paneLayouts.ts` has eight names, and `docs/future/remote.md:89` says six. Eight names and seven
  components is the fact.
- 04-kit.md's node table names `Slot`, `Image`, `Avatar`, and `Toggle`. `Slot` is not a kit node,
  `Image` never shipped, and the other two are `UserAvatar` and `ToggleButton`. Nothing in `docs/`
  carries the table, so nothing can be corrected in place.
- 53 source comments and 22 doc lines link into a folder whose README says the owning docs win.
  A reader following `packages/protocol/src/tree/messages.ts:2` lands on a design record rather than
  the contract.
- The three owning docs that delegate ownership back to this folder (`ui-design.md:328`,
  `panes.md:64`, `plugins.md:898` and `:1639`) invert the folder's own rule.
- `docs/testing.md:276` calls this folder "untracked" and "in progress". It is neither.

The code comments are good. They say why, they name the file they came from, and the
`ponytail:` marker on `protocol/src/tree/props.ts:9` records a ceiling with an upgrade path.

## What this review did not do

It did not run the app, so it says nothing about how any pane looks. It did not run `pnpm test`; the
phase files' claim that lint and test are green at `4dbbecf3` is taken on trust. It did not read the
three published pages the README names as the origin record.
