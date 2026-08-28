# Phase 9: cleanup, docs, and the full test pass

Status: not started.

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
  the consistency review flagged.
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
