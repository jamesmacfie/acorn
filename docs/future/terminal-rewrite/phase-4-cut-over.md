# Phase 4: cut over

Status: not started. Waits on phases 1 and 3. This is the only phase that deletes anything.

## Goal

OpenTUI is gone from the terminal client. The switch is gone. `acorn` runs on the Node the repo pins
with no flag, and its whole test suite draws on that Node. The seven workaround sites are deleted,
not adapted. The behaviour moves into [tui.md](../../tui.md) and this folder is deleted with a
paragraph in [../README.md](../README.md) § Retired folders.

## Why this phase is separate

Phases 2 and 3 build beside the old painter so the goldens can judge them. That means every file they
touch carries both implementations for a while, and every dependency both painters need is installed.
Cutting over is a distinct act with its own risk: it is the moment the fallback goes. Doing it as one
phase, after both painters have run the full suite side by side, means the deletion is a diff a
reviewer can read in one sitting and revert in one commit if a real terminal shows something the
harness did not.

It is also where the runtime floor changes, and that has consequences outside `apps/tui`:
[bundle.md](../bundle.md) § Ordering step 7 ships `acorn` in the node tarball, and its runtime pin
today is the reason that step is hard. After this phase the tarball's Node is the client's Node.

## Scope

In:

- **Remove the switch.** `ACORN_TUI_PAINTER` and `__ACORN_PAINTER__` go from `apps/tui/vite.config.ts`,
  `apps/tui/vitest.config.ts`, and every file that branched on them. The alias for `@opentui/solid`
  becomes an alias of our reconciler module under whatever name the Solid transform is given; the
  cleanest is to set `moduleName` to the module's own path and drop the alias.
- **Remove the packages.** `@opentui/core`, `@opentui/solid` from `apps/tui/package.json`.
  `@opentui/keymap` stays if phase 1 kept the engine (its decision), and is then a dependency shared
  with client-core for the desktop's HTML adapter; note in `package.json` why it is there.
- **Delete the workarounds.** `apps/tui/src/kit/reconciler.ts` (replaced by the tree module),
  `apps/tui/src/renderGuard.ts` and `apps/tui/src/renderGuard.test.ts` (replaced by the clamp in the
  layout read-back and its test), `apps/tui/src/ffi.ts` and every `describe.skipIf(!hasFfi)`, the
  Node version check and `createCliRenderer` call and console suppression and listener cap in
  `apps/tui/src/main.tsx`, the `RGBA` adapter in `apps/tui/src/appearance.ts`, the `RAW_KEYS` table in
  `apps/tui/src/kit/render.tsx`, the `extend()` call in `apps/tui/src/kit/rectangle.tsx`, and the
  `--experimental-ffi` in `apps/tui/package.json`'s scripts.
- **Rewrite the harness.** `apps/tui/src/kit/render.tsx` and `apps/tui/src/harness.tsx` keep their
  exported shapes and are reimplemented over the test renderer from phase 2: stdout is a buffer sink,
  stdin is a queue, `press` pushes a `KeyEvent`, `captureCharFrame` and `captureSpans` read the
  buffer. `KEY_SETTLE_MS` goes, because there is no byte parser between a pushed event and the
  dispatcher in a test. The twenty-step settle loop in `harness.tsx` stays if the first render in a
  fresh worker still pays for compiling every module; that is a Vite cost, not a painter cost.
- **Delete the goldens and their comparison.** `apps/tui/golden/` (delete) and `apps/tui/src/golden.test.ts`
  (delete). The intent tests are the specification again. Before deleting, run the comparison one
  last time and record here any golden that was corrected during phases 2 and 3 with the sentence in
  [ui-design.md](../../ui-design.md) that justified the correction.
- **Drop the dead dependencies.** `apps/tui/package.json` lists nineteen `@codemirror/*` packages,
  `codemirror`, `shiki`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `idb-keyval`, and
  `lucide-static`. The review found none of them does work on this host: CodeMirror arrives as bytes
  in a lazy chunk because `EditorPane.tsx` imports it directly, and the rest are aliased to stubs or
  never reached. Remove each, run the build and the startup graph check, and put back only what the
  build proves it needs. This is not a painter change and could be its own commit; it is here because
  the phase already has `package.json` open and the startup graph check is the same test.
- **Re-measure.** `apps/tui/scripts/check-startup-graph.mjs` over the built output; record the eager
  closure beside the numbers phases 2 recorded, and lower the 870,000 byte ceiling to what the new
  number allows with the same headroom the current ceiling has over the current number.
- **The runtime floor.** `apps/tui/package.json` gains an `engines` field matching
  `node-runtime.json`'s, because there is no longer a reason to run this package on a different Node
  from the rest of the repo and every reason to say so. The `tui` project in `apps/tui/vitest.config.ts`
  drops its version branch.
- **Docs.** See below. This is half the phase.

Out: any change in what a reader sees. Any change to the kit or the layouts. Performance phase 9's
windowing, which starts after this.

## Design

There is no design in this phase; there is a checklist and a diff. The one judgement call is the
order of deletions, and the rule is: delete the consumer before the provider, run the suite after
each, and stop at the first red. The order that satisfies that:

1. The switch, so there is one code path.
2. The test gates (`hasFfi`), so the suite runs everywhere; expect it to be green because phase 3
   ran it under `own`.
3. The harness rewrite, because the old harness imports `@opentui/core/testing`.
4. The workaround files and the `main.tsx` sections.
5. The two `@opentui` packages, then `pnpm install`, then the build, then the startup graph check.
6. The dead dependencies, one group at a time, with the build between.
7. The goldens.
8. The docs.

## Code touched

Everything named under Scope. Nothing outside `apps/tui` except the docs and
`docs/future/README.md`.

## Tests

- The whole `apps/tui` suite on Node 24.11.0 with no flag, green, no skips that name FFI.
- `apps/tui/src/node/boot.test.ts`: a real standalone node, a real attach, on the pinned Node.
- `apps/tui/src/startupGraph.test.ts`: the new ceiling holds and `KNOWN` is still empty.
- `tools/arch/kitTable.test.ts`: the three lists are still one, because no component was added or
  removed.
- `tools/arch/docPaths.test.ts`: every path in the rewritten docs resolves.
- By hand, in at least three real terminals (one that speaks the kitty protocol, one that does not,
  and tmux), the smoke items in [testing.md](../../testing.md) § The smoke checklist that mention the
  terminal client, recorded here with the terminal and its version.

## Docs owed

This is the phase that pays every debt the programme incurred, and it is written so that the folder
can be deleted at the end of it.

[tui.md](../../tui.md):

- § The runtime floor: rewritten. The floor is the repo's, and the section becomes two sentences and
  a pointer to `node-runtime.json`.
- § The host switch: the alias list loses `@opentui/solid`; the paragraph on the reconciler's two
  replacements becomes a paragraph on the tree module and the nine operations.
- § Rendering: the component table paragraph stays; the render guard paragraph is replaced by the
  layout read-back's clamp; the stderr paragraph is replaced by "paint writes stdout".
- § Loose text under a box and § Destroy on disposal: deleted, with one sentence each saying what
  made them unnecessary, because the next person to see `<Stack>{count()}</Stack>` in a review
  should know it was once a crash and is not one.
- § Rectangles: the `pty` bullet names `@xterm/headless` and the encoder.
- § Keys and focus: § The adapter names our `KeymapHost`; § Focus regions' first paragraph says the
  store owns focus; the second-reveal paragraph goes; § The Rectangle contract's `visible` paragraph
  becomes one sentence.
- § Tests: the harness is ours.
- § Shipping it: the runtime pin sentence goes.
- A new short section, § How a frame is drawn, holding the four-layer picture from
  [architecture.md](./architecture.md) and the invariants at each boundary. That is where the
  architecture file's content lands; the file itself is deleted.

[testing.md](../../testing.md) § Test layers: the `tui` suite's paragraph loses "JSX goes to
OpenTUI's reconciler" and the FFI skip sentence; invariant 9's sentence. § The smoke checklist: the
terminal items re-read for anything that named OpenTUI.

[ui-design.md](../../ui-design.md) § The closed kit, if it names OpenTUI as the second host's
renderer; § Icons if the emoji ban is lifted.

[security.md](../../security.md): the terminal's five entries are about process boundaries and
tokens, not the painter; re-read and confirm nothing changes.

[bundle.md](../bundle.md) § Ordering step 7 and § The snags: the runtime pin for `acorn` goes; the
two native modules sentence loses OpenTUI's.

[../README.md](../README.md): this programme's row moves to § Retired folders with a paragraph naming
where each part went, in the shape the `terminal-updates/` paragraph has.

[performance.md](../../performance.md) § 2026-09-03 — phase 9:
its premises are re-read against the new store; the indexing items are marked done by construction or
still open.

## Done when

- `node --version` in CI is the repo's pin and `pnpm --filter @acorn/tui test` draws.
- `grep -rn "opentui" apps/tui --include='*.ts' --include='*.tsx' --include='*.json' --include='*.mjs'`
  returns only the `@opentui/keymap` dependency line and its comment, or nothing.
- `apps/tui/src/kit/reconciler.ts`, `apps/tui/src/renderGuard.ts`, `apps/tui/src/ffi.ts`, and
  `apps/tui/golden/` do not exist.
- The docs above are rewritten and `tools/arch/docPaths.test.ts` is green.
- This folder is deleted in the commit after the one that lands the docs, with the retired-folders
  paragraph in place, which is the convention every retired programme here follows.

## Verify before building

- Phases 1 and 3 are shipped and the suite is green under `own` at both sizes.
- Confirm the dead-dependency list against `apps/tui/package.json` at the time; performance phase 1
  said it would remove CodeMirror from this host and may have done some of this.
- Confirm `node-runtime.json` still pins 24.11.0 and what `engines` it declares.
- Read the current [tui.md](../../tui.md) end to end before rewriting a section; it holds many rules
  this programme does not change, and a rewrite that drops one is a regression the tests will not see.
