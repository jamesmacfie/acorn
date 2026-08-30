# Phase 10: finish the implementation

Status: not started. Follows phase 9. Everything here was found by checking the phase files' own
"owed" comments against the code on 2026-08-30; nothing is new design.

## Goal

Make the code match what the phase files and the owning docs say it does. One dead hook, one scoping
gap between two extension kinds, the tests three phase files promised, and a decision on the draw
sites and the region seam.

## Scope

### Fix

1. **Run `terminal:before-run-target`.** `plugins/terminal/src/main/runIpc.ts:52` forwards `hooks`
   into `createRuntimeService`; `plugins/terminal/src/main/runtime.ts` never reads it. Call
   `hooks.run('terminal:before-run-target', payload)` where a run target starts and honour the
   verdict, or delete the declaration from `plugins/terminal/src/node/index.ts:82`. Declared and
   never run is the worst of the three, because the trust prompt promises a veto nobody gets. Add a
   test that a veto handler stops a run. Replace the `...(hooks ? { hooks } : {})` spread with a
   plain property so the compiler sees it.
2. **Give a slot's tree a subject.** `Slot.tsx:75` mounts `RemoteTree` without `scope`. Decide what a
   contributor inside an owner's pane may reach: the recommendation is the owner's `taskId` and
   `projectId`, read-only, the same as `InlineSlot.tsx:61` already passes for a rectangle. Then
   `openPane` and in-app `openUrl` work from a tool card, and the two kinds agree. Record the
   decision in `docs/plugins.md § Cooperative extension points`, where phase 3's "inert from a tree"
   deviation is not written down anywhere a plugin author would read.
3. **Delete the priority-20 layer from the comment** at `keys/install.ts:11-17`, or register it.
   Nothing uses it.
4. **Stop reading `window.innerWidth` in layouts.** `DocumentSplit.tsx:49` and `ListDetail.tsx:39`
   clamp a drag against the window. Clamp against the layout's own element instead
   (`offsetWidth` of the pane), which is what `ListDetail.tsx:36` already measures for the list.
   Then `shell.css:112` and `docs/panes.md` are true.
5. **Make `focusRoles.ts` honest about `Grid`, `DiffPane`, and `KeyValueEditor`.** They are marked
   `collection` and do not use `createCollection` or the collection store. Either add a role
   (`virtual-collection`) with a sentence in `docs/command-palette-and-shortcuts.md`, or give
   `KeyValueEditor` row roving through `createDomCollection` (the cheap one, since its rows are in
   the DOM) and leave `Grid` and `DiffPane` as the documented exception. `KeyValueEditor` roving was
   owed by phase 2 deviation 4.

### Decide

6. **The three unbuilt annotation sites.** `editor:line`, `editor:path`, and `core:task` are in
   03-extension-kinds.md and phase 4 as the first draw sites, and `docs/future/rail-tab.md:37` says
   slice 3 is superseded by `core:task`. None exists. Build `core:task` on the rail task row, because
   rail-tab.md already depends on it and the mechanism is three lines (`<AnnotationMarks
   point={CORE_TASK_POINT} itemKey={{ task: id }} />` next to the row). Strike `editor:line` and
   `editor:path` from the docs until a plugin asks; the editor's gutter is Monaco's and a mark there
   is a decoration, not a kit draw site, which phase 4 did not notice.
7. **The region seam.** The review README's "one open design question". Two outcomes:
   - Add `model` to `PaneLayoutContribution`, created once per task and passed to every region,
     disposed on `onScopeEvicted`. Delete the four hand-rolled root maps (`notesModel.ts:38`,
     `changesModel.tsx:31`, `agentPaneModel.ts:36`, `contextModel.ts:26`). Move http, linear, and
     rollbar to the layouts the survey named and delete the comment at
     `plugins/http/acorn-plugin.config.mjs:79-81`.
   - Or, decide the narrow projection is not coming, and have phase 11 strike it from the docs and
     say a split inside a region is the plugin's.
   The first is recommended. Do not let this be decided by leaving it.

### Test

8. **A test plugin declaring all five kinds**, installed from disk in the desktop boot test or in a
   node-core test, with a rows strip, a mark on a diff, a card in a slot, an inline rectangle beside a
   pane, and a veto on `changes:before-push`. Phase 4's "done when" and never written. The
   `create-acorn-plugin` tree template already declares two kinds; extend it as the fixture rather
   than writing a second plugin.
9. **The three missing focus tests** from 07-focus-and-keys.md § Rules with tests behind them:
   `nextRegion` walked around every layout returns to the start (only `list-detail` is walked in
   `keys.test.tsx:214`); every kit node with actions operable with hover disabled (no test mentions
   hover); `role="tree"` on `Rows tree` and `aria-modal` on `Modal` asserted (implemented at
   `Rows.tsx:83` and `Modal.tsx:54`, asserted nowhere).
10. **A client-side test for rectangle slots.** `InlineSlot.tsx` and the `inline` branch of
    `frames/register.ts` have no test; only the manifest parser does. Two iframes are siblings, the
    contributor's is under the owner's pane, and a `max` overflow is disclosed. `InlineSlot.tsx:44`
    never reads `overflow`, so a rectangle point past its ceiling drops contributors silently. Fix
    with the test.
11. **A jsdom project for plugin packages.** Phases 7 and 8 both deferred it here and phase 9 did not
    answer. Add a `hosts` project to `plugins/vitest.shared.ts` mirroring
    `packages/client-core/vitest.config.ts:15-31` (`environment: 'jsdom'`, the Solid plugin, `.test.tsx`
    included). Then write the two tests the phases named: the PR pane renders through each tab, and
    the agents `attachment` slot draws a contributor's chip for a `.png`. Without this, no region
    component any plugin ships is tested where it lives.
12. **Anti-vacuity on the div/span rule** in `ui/adoption.test.ts:177-188`. Assert the plugin file
    list is non-empty, as the arch tests do. Widen the `solid-js/web` `render` rule at
    `boundaries.test.ts:931` to catch the namespace-import form.

### Small

- `packages/client-core/src/plugins/frames/remoteSolid.ts:15` still documents `framework: 'solid'`
  as a key you name. Deleted in phase 9.
- `create-acorn-plugin`'s `--rectangle` flag parsing is untested (`index.mjs:509`); the tests call
  `scaffoldFiles` directly.

## Out of scope

Anything that changes how a pane looks, the smoke checklist (owner's, on `docs/next-review.md`),
and the docs work, which is phase 11 and depends on the decisions in items 6 and 7.

## Docs owed

- `docs/plugins.md § Cooperative extension points`: what a slot's tree may reach (item 2).
- `docs/terminal-and-agents.md` or `docs/plugins.md § Hooks`: `terminal:before-run-target` runs, and
  where (item 1).
- `docs/panes.md § Layout model`: the `model` seam if item 7 takes the first outcome; otherwise the
  sentence that a split inside a region is the plugin's.
- `docs/command-palette-and-shortcuts.md`: the `Grid` and `DiffPane` exception (item 5).
- `docs/future/rail-tab.md`: `core:task` exists, or slice 3 is unsuperseded (item 6).
- `docs/testing.md § Test layers`: the plugin `hosts` project (item 11).

## Done when

- `terminal:before-run-target` has a test that a veto stops a run, or the declaration is gone.
- A tool card can `openPane` into the task it is drawn in.
- Items 6 and 7 are decided and the decision is in the owning doc.
- The five-kinds fixture runs end to end.
- `pnpm lint` and `pnpm test` are green, including the new plugin `hosts` project.

## Verify before building

- `plugins/terminal/src/main/runtime.ts` still has no `hook` in it.
- `packages/client-core/src/plugins/tree/Slot.tsx:75` still mounts `RemoteTree` without `scope`;
  `RemoteTree.tsx:44` still types `scope` as optional.
- `packages/client-core/src/ui/kit/focusRoles.ts` still marks `Grid`, `DiffPane`, and
  `KeyValueEditor` as `collection`.
- `plugins/vitest.shared.ts:12-14` still sets `environment: 'node'` and includes only `.test.ts`.
- `grep -rn "core:task\|editor:line\|editor:path" packages plugins` still finds nothing.
