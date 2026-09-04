# Phase 4: cut over

Status: two slices built 2026-09-04. The first settled the goldens and took out the switch, the gates
and the harness. The second took out the workaround files, the two painter packages, four of the dead
dependencies, the goldens themselves and the runtime floor. Only the docs are left. This is the only
phase that deletes anything.

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
  layout read-back and its test), `apps/tui/src/ffi.ts` and every `describe.skipIf(!hasFfi)` (deleted),
  the
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
- `apps/tui/src/kit/reconciler.ts`, `apps/tui/src/renderGuard.ts`, `apps/tui/src/ffi.ts` (deleted), and
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

## What building it found (2026-09-04)

The first slice is built: the last five goldens are settled, the build switch is gone, the FFI gates
are gone, and the harness is ours. `pnpm --filter @acorn/tui test` runs on Node 24.11.0 with no
flag and no `--experimental-ffi`, and it draws: **584 passing, 2 failing, 5 skipped**, against 559,
2 and 31 at the default switch on Node 26.8.1 the day before. That is the programme's headline
sentence and it is now a measurement rather than a plan. Neither failure is this slice's, and both
were checked on their own: `walks into a command group on return and back out of it on escape` fails
alone and is another session's in-flight palette work; `draws many frames without re-collecting, and
re-collects when the keys move` passes alone three times and is the load-dependent family this suite
has always had. The five skips are the three goldens § The three that are left names and the two
`kit.test.tsx` cases that were never phase 3's. One run of the suite beside another one also red
`browse climbs to the rail` in `reachability.test.tsx`, which passes alone and on its own run: the
same family, and a reason not to run two of these at once on one machine.

`pnpm --filter @acorn/tui lint` is clean. The build is clean and the Solid transform now names our
tree module by its own path, with no alias behind it, which is what § Scope hoped for. The startup
graph check still fails its pre-existing 870,000 B ceiling: 964,995 B, down 5,042 B from the 970,037 B
phase 3 measured under `own`. Lowering the ceiling waits on the dead dependencies, which is a later
step in this phase's own checklist.

### The goldens, settled

Twenty-five of the twenty-eight match cell for cell and run for run under our painter, on the Node
the repo pins. Two were re-captured, three are accepted, and the whole correction list is below.

**The re-capture is under the old painter through this harness, with five seconds of settle.** Phase
3 refused to re-capture under our own painter and the reason stands. What it could not have known is
that the old painter, driven through this harness, does not reproduce its own goldens either: it
reports 19 differences against `agents-80x24`, 15 against `notes-120x40`, and one each against the
two `changes` files. So "the golden is what the old painter draws" had already stopped being true,
and the useful question was why. Three answers, measured:

- **The corrections are one of them, and that half is not a fault.** 360 runs in the set hold a
  colour phases 2, 3 and 4 wrote into the files by hand, so the live old painter still draws the hex
  the correction replaced. This accounts for every residual difference on `changes-80x24`,
  `changes-120x40` and `agents-120x40`.
- **Settling depth is the other, and it swings both ways.** `agents-80x24`'s capture was taken before
  the fixture answered the agents pane's `NEEDS YOU` section, and `notes-120x40`'s live old painter
  is *shallower* than its capture — the detail column still says "Select or create a note". The old
  painter through this harness is therefore not a stable instrument on the surfaces whose content
  arrives late.
- **`changes-80x24` was the same fault as `agents-80x24` and phase 3 had it the wrong way round.**
  Its table says the old painter reports no differences against that golden, so the difference must
  be between the two harnesses' flushes. Measured again: held for thirty seconds, the old painter
  through this harness draws `ChangesHeader` exactly as ours does. The golden was a screen taken
  while a query was in flight, on both surfaces.

So both 80-by-24 goldens were re-captured under the old painter through this harness on Node 26.8.1,
with five real seconds between `until()` and the frame — the one thing the re-capture changes, and
the thing the original capture was missing. Both then took the colour correction, and both now match
our painter with nothing left over. The evidence that this is a re-capture and not a laundering is
that the recaptured files differ from the originals in exactly the rows the fixture had not answered
yet: `agents-80x24` gains its `NEEDS YOU` section, `changes-80x24` gains its header row.

### The three that are left

| Golden | Differences | What it is |
| --- | --- | --- |
| `agents-120x40` | 10 | The last cell of the header row, and the composer's hint wrapping a row differently because of it. |
| `changes-120x40` | 8 | The last cell of four overflowing rows — a copy button's `⧉` and three of a diff count's `−`. |
| `notes-120x40` | 4 | The last cell of two overflowing rows. |

All three are one thing: a row whose children want more room than the row has gives the overflow up
between them, and on the last child of such a row the two Yoga builds land a cell apart. Accepted,
with the reason and the repro recorded here, and `apps/tui/src/golden.test.ts § SQUEEZED` carries the
same sentences where a reader running the suite will find them. There is no owner to hand it to and
no ticket to open: the set is deleted later in this phase.

**`pointScaleFactor` is not the lever, and phase 3's "an afternoon on `pointScaleFactor`" was a
guess.** `@opentui/core` 0.5.9 ships `setPointScaleFactor` as a wrapper over the Zig side and never
calls it, exactly as we never call it on `yoga-layout` 3.2.1. Both builds run at the default, so
there is no setting to match and the difference is the two builds' own arithmetic over negative free
space. Anyone who wants it has the repro: at 120 by 40, `changes` row 3, a 30-cell column holding
`uncommitted`, `/tmp/acorn-fixture` and `⧉` — the old build keeps the `⧉`, ours drops it. Our
`flexShrink` rule is not the difference: `apps/tui/src/layout/props.ts § flexShrinkFor` derives the
same answer `Renderable.setupYogaProperties` did.

### Every correction the set carries

Phase 4 owes this list, and § Scope asks for the sentence in
[ui-design.md](../../ui-design.md) that justified each. There is one sentence and it covers all 360:
a tone on a terminal is "default, and the palette's grey, accent, green, yellow and red", and "a
theme stays 40-odd colours, and on a terminal it is 16 of them plus bold"
([ui-design.md](../../ui-design.md) § Roles, and what each host makes of them). Neither hex the set
held is one of the sixteen and neither comes from any theme, so the sentence won and the goldens were
corrected to the colour the kit's own role returned — read off the live frame at the same column and
refused unless the answer was one of the slots.

Counted by diffing each file against its phase 0 capture at `f712312b`:

| Correction | Runs | Where it came from |
| --- | --- | --- |
| `#00AAFF` → the terminal's own foreground | 184 | An overlay's border. `Modal` asks `boxBorder('surface')` and names no tone. |
| `#00AAFF` → the accent slot | 168 | A lit panel's border. `panel.tsx` asks for `tone: 'accent'` when focus is within it. |
| `#666666` → the palette's grey | 8 | A field's placeholder, `TextareaRenderable`'s default. |

Per file, and the two re-captures marked:

| File | Runs | File | Runs |
| --- | --- | --- | --- |
| `agents-80x24` (re-captured) | 12 | `agents-120x40` | 12 |
| `browse-80x24` | 13 | `browse-120x40` | 13 |
| `changes-80x24` (re-captured) | 13 | `changes-120x40` | 13 |
| `context-80x24` | 12 | `context-120x40` | 12 |
| `editor-80x24` | 12 | `editor-120x40` | 12 |
| `help-80x24` | 32 | `help-120x40` | 32 |
| `inbox-80x24` | 10 | `inbox-120x40` | 10 |
| `notes-80x24` | 13 | `notes-120x40` | 13 |
| `palette-80x24` | 23 | `palette-120x40` | 23 |
| `pr-80x24` | 12 | `pr-120x40` | 12 |
| `project-80x24` | 6 | `project-120x40` | 6 |
| `quit-80x24` | 8 | `quit-120x40` | 8 |
| `trust-80x24` | 10 | `trust-120x40` | 10 |
| `workspace-80x24` | 4 | `workspace-120x40` | 4 |

One run in the whole set refused and stayed `#666666`: the composer's placeholder in
`agents-120x40`, at column 67 of row 35, which the squeeze above has moved — so there is no live run
at that column to read a colour off. That is phase 2's stated limit doing what it said it would.

**A golden cannot hold a number that comes from the clock, and two of them were.** The fixture's pull
request is stamped `updatedAt: 0`, so the `pr` detail row says how many months ago the epoch was, and
it goes up by one every thirty days. It went from 689 to 690 on 2026-09-04, which is the day this
slice ran, so both `pr` goldens turned red mid-slice for a reason no diff could explain.
`apps/tui/src/golden.test.ts § drifted` blanks the digits on both sides, by as many characters as
they were so a run keeps its width. It is the same shape as the `inverse` bit `notes-80x24` has
carried since phase 0: a golden that cannot be trusted about one value should not become a golden
nobody checks.

### The switch, the gates and the harness

**Setting `moduleName` to the module's own path works, and the alias goes.** § Scope's "the cleanest
is to set `moduleName` to the module's own path and drop the alias" is right, with one thing it did
not say: the alias was doing two jobs. It pointed the Solid transform's emitted calls at our module,
which `moduleName` now does, *and* it made seven ordinary imports of `@opentui/solid` resolve there
too — `render` in `main.tsx` and both harnesses, and `Dynamic` in six chrome and plugin surfaces.
Those had to be rewritten to name `./tree/renderer` directly, and until they were, the built `main.js`
imported the real package and every drawing test died inside `createCliRenderer`. The two in the
harnesses are `await import()` calls, so a grep for `from '@opentui/solid'` does not find them.

**`render` and `Dynamic` had to be typed against Solid's `JSX.Element` rather than our `Node`.** Every
`.tsx` file in the package still carries `/** @jsxImportSource @opentui/solid */`, and tsc reads it,
so the ambient JSX namespace when a component is checked is still OpenTUI's. Both namespaces define
`Element` as `SolidJSX.Element`, so typing the two entry points that way satisfies either — which is
what lets the pragma stay until the packages leave `package.json`. It is worth knowing that the
pragma is now tsc's business alone: at build time `moduleName` decides, and the emitted calls go to
our module whatever the pragma says.

**`ACORN_TUI_PAINTER` reached eleven runtime branches and every one collapsed to the `own` side.**
`kit/scrolling.tsx`'s `nativeViewport`, `kit/asking.tsx`'s `nativeInput` and `nativeTextarea`,
`kit/rectangle.tsx`'s `handedNative` and its `extend` call, `keys/keymapHost.ts`'s OpenTUI adapter,
the `revealInViewports` call in `keys/regions.ts`, the paste-listener gate in `keys/install.ts`, the
`createCliRenderer` call and the Node 26.4 check in `main.tsx`, and `colourCompat.ts`'s conversion.
`apps/tui/src/painter.ts` and `apps/tui/src/ffi.ts` are deleted, along with `canDraw` in 22 test
files. `extend` and the `embedded_terminal` tag went with the rectangle's OpenTUI half, so
`tree/node.ts` and `tree/jsx.ts` each lost an entry and `tree/tree.test.ts` lost two cases.
`invariants.test.ts`'s focusable census drops from two writes in `kit/rectangle.tsx` to one, which is
the census doing its job.

**`KEY_SETTLE_MS` was doing a second job nobody had written down.** § Scope says it goes "because
there is no byte parser between a pushed event and the dispatcher in a test", and that is true: a
test constructs a `KeyEvent` and pushes it onto the key stream, so nothing is holding a lone Escape
to see whether a sequence follows. It is gone from `kit/render.tsx`, where a fragment under test has
no transport behind it and the whole suite is green without it. It had to stay in `harness.tsx`. What
the wait was also doing is giving real time to whatever the press started: a Tab lands the caret on a
row whose data the fixture answers on a 50 ms timer, and turning the render loop does not make a
timer fire however many turns it is given. Taking it out reds `browseSlow.test.tsx`'s re-suspending
case and `browse at 80 by 24` in `reachability.test.tsx`, and nothing else. The comment above it now
says the real reason.

**The twenty-step settle loop stays, and it is measured rather than inherited.** § Scope asks for the
measurement before deciding. Taking the loop out reds the same two cases and nothing else, which is
the same pair the press wait holds up and the same cause: the first render in a fresh worker pays for
compiling every module the pane pulls in, which is a Vite cost and is why one painter did not end it.

**`RAW_KEYS` is gone**, with the OpenTUI test renderer it fed. So is the console pair both harnesses
called before taking a frame: `openOwnRenderer`'s console is a no-op shim, so `deactivate()` and
`hide()` were doing nothing. `golden.test.ts` and `captureGolden.tsx` still call them and still
should — they go with the goldens.

### What the next slices must know

- **`apps/tui/src/kit/reconciler.ts` is unreferenced but still compiled.** Nothing imports it and no
  alias points at it, so deleting it is a one-line change; it was left in place because § Design puts
  the workaround files after the harness.
- **`@opentui/core` is still named in 40 files and almost all of it is types** — `CliRenderer`,
  `Renderable`, `KeyEvent`, `ScrollBoxRenderable`, `InputRenderable`, `TextareaRenderable`. Six
  imports are values: `RGBA` in `apps/tui/src/colourCompat.ts`, `CliRenderEvents` in
  `apps/tui/src/main.tsx`, `TextAttributes` in `apps/tui/src/kit/kit.test.tsx`, and `Renderable` or
  `BoxRenderable` in the three workaround files a later step deletes. Removing the package means
  replacing those type names with ours, and `colourCompat.ts § paintColor` says which cast goes with
  them: it is the identity, and only its return type does anything.
- **Every `.tsx` file still carries `/** @jsxImportSource @opentui/solid */`** and it is tsc's
  business alone now — the build reads `moduleName` and sends every call to our module whatever the
  pragma says. The pragma cannot go until the JSX namespace `apps/tui/src/tree/jsx.ts` declares is
  what tsc reads, which is the same step that removes the package.
- **`renderer.console` is a shim with four no-op members** (`apps/tui/src/ownRenderer.ts`), kept
  because `main.tsx` prints `getCachedLogs()` on the way out and the golden capture calls the other
  three. Both callers go in later steps of this phase, and the shim goes with the second of them.
- **The `pr` goldens' month count is blanked, not fixed.** If somebody keeps the set past this phase,
  the real fix is a fixture timestamp that is not the epoch.
- **The startup graph is 964,995 B against an 870,000 B ceiling.** The check has been failing since
  before this programme; the dead dependencies are what is supposed to close it.

## What building it found, second slice (2026-09-04)

Steps 4 to 7 of § Design are done: the workaround files, the packages, the dead dependencies, the
goldens, the re-measurement and the runtime floor. Only § Docs is left.

`grep -rn "opentui" apps/tui --include='*.ts' --include='*.tsx' --include='*.json' --include='*.mjs'`
now returns the `@opentui/keymap` dependency line, its `"//dependencies"` note, the `@opentui/keymap`
imports in `apps/tui/src/keys/`, the citations of that engine's source in comments, and
`apps/tui/src/invariants.test.ts`, whose rule has to spell `@opentui/` to forbid it. Nothing names
`@opentui/core` or `@opentui/solid` anywhere.

The suite is **557 passing, 2 failing, 2 skipped** on Node 24.11.0 with no flag, against the first
slice's 584, 2 and 5. Every number that moved is a deletion: `renderGuard.test.ts` was two cases, the
golden file was twenty-five plus its three skips. Both failures are the first slice's two, and both
were checked alone: `walks into a command group on return and back out of it on escape` fails alone
and is another session's palette work; `draws many frames without re-collecting` passes alone and is
the load-dependent family. The two remaining skips are the `kit.test.tsx` Yoga cases, which were never
this programme's. `pnpm --filter @acorn/tui lint`, `npx oxlint apps/tui` and `tools/arch` are clean —
`docPaths` aside, on which see below.

### What was deleted, and the three things that moved instead

Deleted: `apps/tui/src/kit/reconciler.ts`, `apps/tui/src/renderGuard.ts`,
`apps/tui/src/renderGuard.test.ts`, `apps/tui/golden/`, `apps/tui/src/golden.test.ts`,
`apps/tui/src/golden.ts`, `apps/tui/src/goldenSurfaces.ts`, `apps/tui/src/captureGolden.tsx`, its
Vite entry and its `package.json` script, `main.tsx`'s console suppression and listener cap, the
`RGBA` adapter and `paintColor` in `apps/tui/src/colourCompat.ts`, and six members of the renderer
shim nothing asked for any more (`console`, `capabilities`, `focusRenderable`, `setMaxListeners` and
the two input-handler no-ops).

Before deleting `renderGuard.test.ts`, both halves of what it pinned were checked against
`apps/tui/src/layout/layout.test.ts`: § clamps the rectangle of a node that joined the tree after the
pass is the first, and the second — that a resize handler reads an already-clamped size — was
OpenTUI's `ScrollBox` reading its own `NaN` mid-write and has no counterpart here, because the
read-back writes a rectangle and calls `onSizeChange` afterwards.

Three of the four files § Your slice asked about turned out to be the only implementation, not a shim,
and stayed:

- **`apps/tui/src/tree/compat.ts`** is where the node type now lives. It gained an exported
  `Renderable` interface — the tree's own fields plus `x`, `y`, `width`, `height`, `visible`,
  `isDestroyed`, `focusable`, `focus`, `blur`, `getChildren`, `id`, and the three hooks a widget or
  the store installs on a node (`onMouseDown`, `handleKeyPress`, `scrollChildIntoView`). That is the
  type twenty files used to import from `@opentui/core`, and `BoxRenderable`, `ScrollBoxRenderable`,
  `InputRenderable` and `TextareaRenderable` all collapsed into it, because the distinctions were
  class names and there are no classes. Rewriting `keys/regions.ts` to read `Node` directly and
  deleting this file is still owed and is still not this phase: the names are the store's whole
  surface, so it is a thousand-line diff with no behaviour in it.
- **`apps/tui/src/ownRenderer.ts`** is the only renderer, so it stayed and lost the six dead members.
- **`apps/tui/src/ownKeys.ts`** holds `OwnKeyEvent`, which is the key type the keymap engine reads;
  the eight files that imported `KeyEvent` from `@opentui/core` now import it under that name.

The `own` prefix on both files no longer distinguishes anything and should go, but renaming them now
would break `docs/tui.md`'s citations and redden `tools/arch/docPaths.test.ts` before the docs slice
can fix it. It belongs with the docs.

### The pragma is `@acorn/tui/jsx`, and it had to stay per-file

§ What the next slices must know said the pragma could not go until tsc reads
`apps/tui/src/tree/jsx.ts`'s namespace. It now does: `apps/tui/src/tree/jsx-runtime.ts` re-exports
that namespace, `tsconfig.json` maps `@acorn/tui/jsx/jsx-runtime` to it, and all 61 `.tsx` files say
`/** @jsxImportSource @acorn/tui/jsx */`.

**Setting `jsxImportSource` once in `tsconfig.json` instead would have been wrong.** tsc pulls
client-core's own `.tsx` sources into this program, and a compiler option applies to every file in it
— those are DOM components and their JSX namespace has to stay Solid's. A per-file pragma is the only
form that says "this package's files, not the ones it drags in".

Switching it found five real prop errors the old namespace had been hiding, and each is a deletion the
phase file asked for:

- `kit/cells.tsx § Run` spelled its style twice, `{...run().style} style={run().style}`, because the
  old painter ignored every prop on a text node but `href` and `style`. § Scope asked for that half to
  go and now it has to.
- `kit/grouping.tsx § Inline` passed `flexWrap="no-wrap"`, which is OpenTUI's spelling; Yoga's is
  `nowrap`. It was landing on `WRAPS[...] ?? Wrap.NoWrap`, so the answer was right by accident.
- `kit/roles.ts § Style.fg` was typed `ReturnType<typeof paintColor>`, which is why `paintColor`
  existed at all. It is a `Color` now and the identity cast is gone from forty call sites.
- `kit/showing.tsx` typed a wheel handler as OpenTUI's `MouseEvent`; it is `tree/hit.ts § Wheel`.
- `kit/scrolling.tsx § Viewport` is exported now and carries `scrollTop`, because `DiffPane` reads it
  off the node and `ScrollBoxRenderable` used to declare it.

### `rgbOf` stays, `paintColor` and `toRgba` go

`paintColor` was the identity and only its return type did anything, so it went with the JSX
namespace. `toRgba` had one caller. But `rgbOf` is not golden machinery and does not go with the
goldens: `kit/render.tsx § runs` and `harness.tsx § captureSpans` report a run's foreground as an
`{ r, g, b }` triple, and five live assertions read it — `diffLong.test.tsx` asks that an inserted
line is greener than it is red, `controls.test.tsx`, `extensions.test.tsx` and `scrolling.test.tsx`
each filter for a lit run the same way. So `colourCompat.ts` keeps `rgbOf` over a sixteen-slot table
of its own, at the values `RGBA` answered, and the assertions did not move.

### The dead dependencies: four of the five groups went, and one premise was false

§ Scope says "the review found none of them does work on this host". That is right for three groups
and wrong for two packages, and the evidence is the built output: every bare import is left to the
runtime by `vite.config.ts`, so a chunk that names a package needs it installed the moment that chunk
loads.

Removed, with the build and a resolvability sweep over `dist/` between each group: the thirteen
`@codemirror/lang-*` packages, `@codemirror/legacy-modes`, `@codemirror/language`,
`@codemirror/theme-one-dark`, `shiki`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl` and
`lucide-static` — twenty of them. With `@opentui/core` and `@opentui/solid`, `package.json` goes from
57 dependencies to 35.

Put back, because the build proves this host needs them:

- **`idb-keyval`.** `client-core/src/infra/node/fleet.ts` imports it at module scope, and `main.tsx`
  imports `fleet.ts` before the first frame, so it is in the eager closure the startup check walks.
  Measured rather than argued: with it removed, importing the built `fleet` chunk throws
  `ERR_MODULE_NOT_FOUND: Cannot find package 'idb-keyval'`, which is `acorn` not booting.

  **And the suite does not catch that**, which is the most useful thing this slice learned.
  `apps/tui/src/node/boot.test.ts` passed with the dependency gone, because vitest runs the sources
  and resolves `idb-keyval` from client-core's own `node_modules`, where it is declared. A green suite
  is not evidence that this package's dependencies are complete, and that is now true of six
  specifiers rather than one: `@codemirror/theme-one-dark`, the `@codemirror/lang-*` set,
  `@codemirror/legacy-modes`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl` and `shiki`
  are all answered by a Vite alias that vitest also applies, so nothing in the suite can tell you
  whether the built output would have resolved them. **The built output is the only check.** The one
  used here is a sweep of every double-quoted bare specifier in `dist/` against what `apps/tui` can
  resolve, run after each group of dependencies came out and again after the aliases went in; it
  belongs in `scripts/` the day somebody wants it enforced.
- **`codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`.** `EditorPane.tsx`
  imports `basicSetup`, `EditorState` and `EditorView` directly rather than through
  `@acorn/plugin-api/ui/editor`, and this host draws the editor pane —
  `apps/tui/src/kit/editor.ts` § The ceiling already said so, and `apps/tui/src/panes.test.tsx`
  § editor draws it. Two of them are also the type imports in that stub, so tsc needs them either
  way, and `@codemirror/language` is here because `codemirror` itself depends on it (see the aliases
  below).

**Dropping them left three chunks importing packages that no longer resolve, and that was a
regression — it is fixed with three stubs and three aliases.** The first pass of this slice recorded
those chunks as dead and moved on. They are not dead: `DocumentSurface` and `TerminalPanel` are both
reached by a real `import()` from a chunk in the graph, so they are lazy chunks a reader can hit. With
the packages installed the import resolved and the surface merely failed to draw; without them it is
`ERR_MODULE_NOT_FOUND` the moment the surface opens. Cleanup must not turn a surface that cannot draw
into a process that crashes.

So each specifier is answered locally, the way `@solidjs/router`, `lucide-static/icon-nodes.json` and
`@acorn/plugin-api/ui/editor` already are — a stub with a header saying why this host cannot have the
real thing (`vite.config.ts` § resolve.alias, and `isAliased`, which has to list them too or `external`
wins before the alias runs):

| Stub | Answers | For |
| --- | --- | --- |
| `apps/tui/src/kit/codemirrorGrammars.ts` | `@codemirror/theme-one-dark`, every `@codemirror/lang-*`, every `@codemirror/legacy-modes/mode/*` | `DocumentSurface`, which holds an `HTMLElement` and mounts a CodeMirror `EditorView` into it |
| `apps/tui/src/kit/xterm.ts` | `@xterm/xterm`, its stylesheet, `@xterm/addon-fit`, `@xterm/addon-webgl` | `TerminalPanel`, a `UiSlotContribution` for a drawer slot this host does not have |
| `apps/tui/src/kit/shiki.ts` | every `shiki` specifier — core, both engines, every grammar and theme | the DOM `DiffPane`, the DOM `Markdown` and `TerminalPanel` |

**Every export throws, and names the host.** A stub that answers plausibly is how this host got an
editor pane pulling seventeen grammars it could never highlight, so a surface that does reach one gets
told where it is rather than drawing an empty box somebody has to bisect. As shipped:

> `createHighlighterCore` is shiki, and the terminal client draws in the sixteen slots the reader's
> terminal chose rather than in a theme of ours. Ask a role for a colour instead
> (apps/tui/src/kit/shiki.ts, apps/tui/vite.config.ts).

The patterns are regexes rather than a line per package, because the grammar and theme sets are open:
a language added to `client-core/src/features/editor/language.ts` must not become a package this host
has to install again. The names have to exist as exports even so — the build links a named import
against the stub, so adding a grammar there and not here is a build error rather than a runtime one.

**Two packages are deliberately not aliased, and both are the same mistake.** `@xterm/headless` is the
`pty` rectangle's own emulator. And `@codemirror/language` was aliased for an afternoon and broke the
editor pane in three tests: `codemirror` depends on it, the `editor` pane imports `basicSetup` from
`codemirror`, and under vitest — where `ssr.noExternal` inlines `node_modules` too — the stub was
handed to a package that works here. It is a declared dependency instead. **The rule the two share: a
stub may only stand in front of a specifier no working surface reaches.**

Verified three ways. The dist audit — every double-quoted bare specifier in `apps/tui/dist`, minus
builtins and declared dependencies — reports nothing. Importing `DocumentSurface`, `TerminalPanel`,
`EditorPane` and both shiki chunks in Node links all five, where three of them threw
`ERR_MODULE_NOT_FOUND` before. And the eager closure did not move: 963,998 B before the aliases,
963,962 B after, 98 chunks either way, and none of the three stubs is in the walk. They are bytes in
the lazy chunks that already existed.

`@xterm/headless` stays — it is the `pty` rectangle's emulator, added in phase 3.

### The startup graph: the premise was false and the ceiling went up, not down

§ Re-measure asked for the ceiling to be lowered, and § What the next slices must know said "the dead
dependencies are what is supposed to close it". Neither is true, and the reason is one line:

**Dropping a dependency moves this number by nothing.** `vite.config.ts` externalises every bare
import, so a package that is only ever imported contributes zero built bytes. Removing nineteen
dependencies moved the eager closure from 964,303 B to 964,303 B. What did move it was deleting the
golden capture entry, which took 27 KB off the *built* total but nothing off the eager closure, and
the comment edits in this slice, which took off a few hundred bytes.

The honest numbers, all on Node 24.11.0:

| When | Eager closure | Ceiling |
| --- | --- | --- |
| performance programme phase 4, when 870,000 B was set | 841,142 B | 870,000 B |
| `main` at this programme's start | 875,265 B | 870,000 B — already red |
| phase 3 under `own` | 970,037 B | still red |
| phase 4, first slice | 964,995 B | still red |
| phase 4, second slice | 963,998 B | **995,000 B** |

The ceiling is now the measured number rounded up by about 3%, which is the rule every previous
ceiling here was set by. It went up rather than down because the painter is ours: `ownRenderer`,
`renderer` and `ownKeys` together are 97,889 B of the closure, and 875,265 + 97,889 is 973,154, which
is within a rounding of where we are. What used to be a 6 MB native library outside the bundle is now
about 98 KB inside it. `apps/tui/src/startupGraph.test.ts` holds the new number and `KNOWN` is still
empty.

### The runtime floor

`node-runtime.json` pins `24.11.0` and declares `">=22.18 <23 || >=24.4"`, so `apps/tui/package.json`
now declares exactly that, with a `"//engines"` note saying why the package no longer differs from the
rest of the repo. `apps/tui/vitest.config.ts` had already lost its version branch in the first slice
and has no flag and no skip in it.

### Two loose ends the docs slice owns

- **`tools/arch/docPaths.test.ts` is red on thirty paths inside `docs/future/terminal-rewrite/`**,
  every one of them naming a file this slice deleted. They go when the folder does, which is the last
  commit of the docs slice. The two citations in docs that survive — `docs/tui.md` § Rendering and
  § Loose text under a box, and `docs/performance.md`'s reconciler paragraph — were given a
  same-line "deleted" marker so the check is no redder outside this folder than it was before.
  Everything else it reports is the pre-existing dotfile-path family (`.env`, `.acorn`).
- **A stale claim in `apps/tui/src/kit/scrolling.tsx`.** Its offset is written from an effect rather
  than as a JSX attribute, and the reason it gave was that tsc typed intrinsics against OpenTUI's prop
  shapes. Our `tree/jsx.ts` declares `offset`, so it could be either now; the comment says so and the
  effect stays, because changing it is a behaviour change with no reason behind it.
