# Phase 9: cleanup, docs, and the full test pass

Status: shipped 2026-08-30. What changed on the way is at the end, and the folder README repeats it.

## Goal

Delete every path the earlier phases made unreachable, execute [docs-migration.md](./docs-migration.md)
in full, invert the adoption test so the new rules are permanent invariants, flip the plugin template
to trees, and run the comprehensive test pass the owner does once at the end of the programme.

## Why this phase, and why now

Nothing ships between phases, so nothing needed to stay for compatibility, but deleting mid-programme
would have removed the fallback each per-pane phase relied on. Now every pane has moved, and the
iframe pane path, the per-plugin CSS, the component-taking registries, and the hand-rolled focus
helpers have no callers.

## Scope

### Delete

- The iframe rendering path for non-rectangle surfaces: the `pane`, `refPanel`, `settings`,
  `importer`, `overlay`, and `coreSlot` branches of `frames/register.ts` that mount `PluginFrame`
  for a surface without a layout. `PluginFrame.tsx` survives only behind `Rectangle kind="frame"`
  and `webview`.
- `registries/agentToolRenderers` (the slot replaced it), `contextSectionSlots`, the non-footer
  component `slots` that became layouts or slots; the `taskSlots` and `UiSlotId` two-spelling table
  the 2026-08-27 consistency review flagged (finding 2; the review is in git history).
- `ui/focus.ts`, `lib/isTypingTarget.ts`, and any `onKeyDown` handler in a plugin outside inputs.
- Every `.css` under `plugins/*/src`. Confirm with `find plugins -name '*.css' -path '*/src/*'`.
- `CollapsibleSection` alias, `ListDetail` and `DocumentTabs` as exported nodes (they are layouts).
- The `framework` key in the package builder if the remote adapter is the only target; keep it if a
  vanilla-DOM tree adapter is offered.
- `mountFrame` stays in the SDK for rectangle plugins; `create-acorn-plugin` emits a tree plugin by
  default and a frame plugin behind `--rectangle`.

### Invert the invariants

- `ui/adoption.test.ts` fails on any raw `div` or `span` in a plugin's client tree.
- The kit tests from phase 0 (support matrix, role mapping, no-class) and the tree fuzz from phase 3
  are permanent.
- A new arch rule: no file under `plugins/*/src` imports `solid-js/web`'s `render` except through
  `mountTree`, and none imports a `.css`.
- The `frame-src 'none'` Rust test and the new `worker-src` test stay.

### Documentation

Execute every row in docs-migration.md not already done by an earlier phase. In particular:

- The REWRITE set: `plugins.md`, `ui-design.md`, `panes.md`, `extensibility.md`,
  `contribution-kinds.md`, `plugin-authoring.md`, `plugin-map.md`, `first-party-plugins.md`,
  `third-party/monaco.md`, `future/split.md`.
- Delete `docs/third-party/editor.md` after folding its surviving facts.
- The superseded-by line on each review, with the finding list from docs-migration.md § Reviews.
- `docs/architecture-overview.md` § "Documentation map" points at the rewritten docs.
- `docs/testing.md` § "The smoke checklist" gains keyboard-only traversal of every pane and the trust
  flow for a remote plugin; § "Test layers" lists the new invariants.
- `docs/release-notes-vnext.md` entries.
- This folder's README status line becomes `SHIPPED`, each phase file records its "What changed on
  the way," and the folder's job is done; it sequences and links, and the owning docs describe
  behaviour.

### The test pass

The owner tests comprehensively here and not before. The developer's part:

- `pnpm lint` (oxlint then `tsc --noEmit` in every package).
- `pnpm test` (bounded concurrency; use `turbo run test --continue` to see every red, then re-run
  reds alone, per the memory index note).
- `pnpm --filter @acorn/desktop test` for the boot test and the Rust suite.
- The `docs/testing.md` smoke checklist in full, including the new keyboard and remote-plugin items.
- A fresh `create-acorn-plugin` tree plugin installed from disk, trusted, filling a slot and an
  annotation point, then disabled and uninstalled, with the developer view checked at each step.

## Code touched

- `packages/client-core/src/plugins/frames/{register.ts,PluginFrame.tsx,PluginRefPanel.tsx,
  PluginOverlay.tsx,ExtendedPane.tsx}`.
- `packages/client-core/src/registries/{slots.ts,agentToolRenderers.ts,contextSectionSlots.ts}`.
- `packages/client-core/src/ui/{focus.ts,adoption.test.ts}`, `lib/isTypingTarget.ts`.
- `packages/plugin-api/src/ui/*` barrels and the surface snapshot.
- `packages/create-acorn-plugin/index.mjs` and its test.
- `plugins/*/src/**/*.css`.
- The arch tests (`boundaries.test.ts`, the arch rules in `client-core`).
- Every document in docs-migration.md.

## Docs owed

All of docs-migration.md.

## Doors left open

The permanent invariants are the doors: no class or style prop, no raw scale token, every node with a
support row, every layout with both projections, intents only, one keymap, `frame-src 'none'`.
[09-doors-left-open.md](./09-doors-left-open.md) is checked line by line at the end of this phase.

## Done when

- The deletions above are made and nothing references them.
- `find plugins -name '*.css' -path '*/src/*'` is empty.
- Every document in docs-migration.md is updated, folded, or deleted as it says.
- `pnpm lint`, `pnpm test`, and the desktop suite are green; the smoke checklist passes; a fresh tree
  plugin installs and works.
- The folder README says `SHIPPED` with the date and lists deviations.

## Verify before building

- Phases 0 through 8 are marked shipped in their files with their deviations recorded.
- `grep -rn "PluginFrame" packages/client-core/src --include=*.tsx -l` shows only the rectangle and
  webview paths before deleting the rest.
- `grep -rn "agentToolRenderers\|contextSectionSlots" packages plugins -l` shows only the registries
  themselves.
- `find plugins -name '*.css' -path '*/src/*'` lists what is left to delete.
- docs-migration.md rows marked done by earlier phases are actually done: spot-check
  `docs/plugins.md` § "Cooperative extension points" and `docs/command-palette-and-shortcuts.md`.

## What changed on the way

Eight departures from the plan above. The folder README carries the same list.

**Two deletions were refused, and the argument is the finding.**

`ListDetail` and `DocumentTabs` stay exported kit nodes. The scope line called them layouts, which was
true when it was written and stopped being true during phases 5 to 8: a pane's regions are the *outer*
arrangement, and a split *inside* one region is a different object with a different owner. Ten plugins
split inside a region, github nests two splits in one, and `plugins/http/src/tree/HttpPanel.tsx` says
so at the top of the file. Deleting them would have meant either a pane layout per nesting depth or a
rewrite of every one of those surfaces to lose a split it needs.

`overlay`, `importer` and `coreSlot` still take no layout. The scope line asked for the layout-less
`PluginFrame` branch of all six frame targets. Three of them are rectangles by construction: a
full-screen picker, a wizard the plugin owns, a replacement for one of core's surfaces. Each has no
arrangement to name and no second region, so a layout key there would be a manifest field whose only
legal value is `single` over `frame`, threaded through three registrations that each pass their own
callbacks. `pane`, `refPanel` and `settings` do require one now, enforced in `pluginManifest.ts` and
re-checked over the roster row, and the implicit "no layout means the whole surface is my iframe" path
is gone with it.

**Three things arrived that the plan did not name.**

`Rectangle` gained a fourth kind, `editor`, and a `mount` prop. The kind has two consumers: the editor
pane's Monaco and the host's own document surface, both of which were a `<div>` and a stylesheet. The
prop is what let the last five host elements go: every rectangle holds something that wants a DOM node
of its own, and the host draws that node and hands it over rather than each plugin writing one.

`Drawer` is a host component on `@acorn/plugin-api/ui/host`, beside `PaletteSurface`. Phase 6 recorded
that the terminal drawer's outer box stays the plugin's CSS because no pane layout owns it. That was
the last plugin stylesheet, and where the icon rails are and how tall the top bar is are the shell's
facts. It is not a kit node: its height is a pixel the resize grip produced, which a kit node's props
may not be.

`text` gained a `match` role, for the run inside a line that a search matched. Two surfaces highlight
one, the diff's find bar and the editor's find-in-files, and both spelled the host class
`.ui-find-mark` directly.

**Three consequences of the deletions.**

The plugin API major went from 6 to 7. Removing `agentToolRendererRegistry`, its two types and the
`CollapsibleSection` alias shrinks the published surface, and `surface.test.ts` refuses that under an
unchanged number.

The changes plugin's tool card matches on kind rather than on a predicate. It matched "did this call
touch a path"; as an `agents:tool-card` contribution it declares `['read', 'edit', 'delete', 'move']`.
A point's arbitration has to be decidable without running a contributor's code. It also lost
`onOpenChange`: a function does not cross a port, so both render paths get the same props and only the
owner's own card teaches the fold setting.

The editor plugin was converted here, because no phase had scheduled it and `find plugins -name '*.css'`
could not be emptied without it. Its find-in-files panel is kit nodes over a `Rows` collection, and its
file tree is a flat `Rows tree`, which is how a tree that never had arrow keys got them. Its two
stylesheets are gone and `docs/third-party/editor.md` is deleted, its surviving facts folded into
`docs/first-party-plugins.md` and `docs/panes.md`.

**What is owed.** Items 23 to 25 of `docs/testing.md` § The smoke checklist: keyboard-only traversal of
every pane, and a scaffolded plugin of each shape installed from disk. Both need a person in front of
the running app. They are on `docs/next-review.md` § Verification.
