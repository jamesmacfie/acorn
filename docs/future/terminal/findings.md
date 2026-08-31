# What phase 0 found

Phase 0 shipped on 2026-08-31. `apps/tui/` boots client-core under Node, draws the Notes pane through
OpenTUI's Solid reconciler, and `j` walks the list. This is what it turned up on the way, in the order
a later phase has to deal with it. The screenshot it produced is at the bottom.

Nothing here is a workaround inside `apps/tui/`. Where the finding is about the kit or the host, it
says which phase owns the fix and which document owns the sentence afterwards.

## The kit is intent, not layout

The headline answer is yes. The Notes pane's source is unchanged — same file, same imports, same
props — and it draws legibly at 80 by 24. It spends fifteen kit nodes and reads as a list beside a
note. The pane handles no keys and `j` still moves, because the intent table is host-neutral and the
terminal adapter reads the same one.

Two things made that true, and both were already in the tree before this phase started: the kit takes
roles rather than pixels, and `@acorn/plugin-api/ui` is a facade rather than a set of direct imports.
The facade is the whole host switch for a compiled pane. Aliasing that one specifier to a different
table of components is three lines of build config, and the pane never learns which host it landed on.

## Findings that change a decision

### The runtime floor

`@opentui/core` reaches its Zig core over `node:ffi`, which is a Node **26.4** builtin behind
`--experimental-ffi`. OpenTUI's own runtime-support page says so, and Node 24 has no such module: the
first `createCliRenderer()` throws "OpenTUI native FFI is not available for this runtime yet".

The repo's floor is `>=22.18 <23 || >=24.4`. The README's "One runtime" decision still holds — the node
needs Node 24 for `node:sqlite` and 26 satisfies that — but the floor moves and it moves to a Node that
is Current rather than LTS, for a flag that is experimental. Three places have to answer for it:

- **`08-deployables.md`.** "Bundling the runtime moves up the order" understates it. The TUI cannot run
  on a machine's own Node at all unless that Node is 26.4+, so the bundled runtime is a precondition of
  the headless artifact carrying `acorn`, not a later nicety. `bin/acorn` also has to pass the flag.
- **Phase 5.** Node's `--permission` needs `--allow-ffi` plus read access to the native library for the
  render core, and `--allow-worker` for tree-sitter. `06-isolation.md` designs the sandbox around
  `--permission` being process-wide; the host half now needs two grants of its own before a plugin
  worker gets none.
- **Phase 7.** OpenTUI's Node acceptance lane runs on Linux x64 only. macOS arm64 works — this phase is
  the evidence — but the prebuild matrix in `08-deployables.md` should not be read as tested.

Phase 0 scoped this to `apps/tui`: the package builds and its test skips on an older Node, `main.tsx`
checks the version and says one sentence rather than throwing from inside a chunk, and `vitest.config.ts`
passes the flag only where it is accepted. Whether the repo's floor moves is the owner's call and it is
not phase 0's to make.

### http and linear have no compiled half

Phase 0's scope named them because they are `list-detail` and `header-body-footer`. Both ship only a
tree bundle: `plugins/http/src/` and `plugins/linear/src/` have `tree/` and no `client/`, and http's
node half says so in its own header ("http ships as a loaded plugin"). Drawing either means the worker
sandbox, which is phase 5.

Phase 0 drew **Notes** instead: compiled, `list-detail`, three regions sharing a model, which exercises
the region seam as well as the kit. Context is the compiled `header-body-footer` pane and was left for
phase 1; its `Slot` node pulls the tree host in, which is the same phase-5 dependency by another road.

The layout components for both `list-detail` and `header-body-footer` exist in `apps/tui/src/layouts/`.

### The pane registry draws DOM layouts

`drawLayout` in `packages/client-core/src/host/registries/panes/panes.ts` turns a declared layout into a
component, and that component mounts `LAYOUTS` from `client-core/src/host/layouts` — the DOM table,
named directly. So `paneContributions()` hands a second host a component it cannot use.

This is the one place the pane path is not host-neutral, and it is the same shape of problem
`KIT_COMPONENTS` already solved: the table has to be supplied by the host package. Everything else in
that file is fine — `paneModel`'s per-task root, the region getters, the hidden-region check — and the
TUI uses them as they are. Phase 0 works around it by reading the regions back off the entry, which
`drawLayout` spreads through; the cast in `apps/tui/src/App.tsx` names this finding.

**Owner: phase 2**, alongside the layout components. `docs/panes.md § Layout model` gets the sentence.

### A pending `lazy()` region is an empty string, and cells refuse one

Every pane contribution's regions are `lazy()` components. Until one resolves it renders as `''`. On the
DOM that is an empty text node nobody sees; OpenTUI refuses it, because a run of text in a terminal must
have a `text` parent, and the mount fails with "Orphan text error".

The host has to give every region a real placeholder. `apps/tui/src/App.tsx` wraps each in a `Suspense`
with one dim line. Nothing in client-core does this today — there is no `Suspense` anywhere in
`host/` — so it is not a rule a pane can be asked to keep.

**Owner: phase 2**, in the layout mount path rather than in each layout.

### Every element-typed prop needs the same check

The same rule, one level down. `leading`, `trailing`, `meta`, `actions`, `action`, `icon` are typed
`JSX.Element`, and a pane hands them bare strings — `meta={authorBadge(note.author)}` is a string, and
correct kit. The DOM absorbs it; cells do not.

`apps/tui/src/kit/components.tsx` has one `slot()` helper that wraps a string or a number in a `text`
and drops the empty string. **Owner: phase 1**, which writes the other fifty-four nodes: every one with
an element-typed prop needs it, and it belongs in the host's own helper rather than in each component.

### Solid's identity has to be one instance, including OpenTUI's

Two traps in the same place, both silent:

- `solid-js` resolves to its **server renderer** under Node's `node` export condition, which has no
  reactivity. Every consumer that runs Solid on a real Node points at `solid-js/dist/solid.js`;
  OpenTUI's own Node harness does the same.
- `@opentui/solid` holds the renderer in a Solid **context**. Left external while Solid is bundled, it
  gets a second copy of Solid and a second set of contexts, and the failure is "No renderer found"
  thrown from a component that is plainly under the provider.

`apps/tui/vite.config.ts` bundles `solid-js`, `@tanstack/*` and `@opentui/solid` into one module graph
and leaves `@opentui/core` external. This is the same hazard `pnpm-workspace.yaml`'s catalog exists for,
one layer out, and phase 7 has to keep it true when the bundle becomes an artifact.

### client-core is DOM-typed all the way down

`apps/tui`'s tsconfig cannot narrow `lib` to `ESNext` the way `apps/node`'s does. tsc pulls client-core's
sources into the program — `host/keys/focusRegions.ts`, `kit/keys/keymapHost.ts`,
`features/notifications/notifications.ts` — and they name `HTMLElement`, `document` and `Notification`
at the type level whether or not this host draws them. So `lib` includes DOM here, which means the TUI's
own files could reference `document` and tsc would not object.

`05-keys-and-focus.md` already plans the split for focus and keys. This is the measurement of how much
else is on that list. **Owner: phase 2**, and the line in `apps/tui/tsconfig.json` says so.

The JSX source is set per file with a `/** @jsxImportSource @opentui/solid */` pragma rather than in
tsconfig, for the same reason: a whole-program setting would also apply to client-core's components,
and `@opentui/solid` is not a dependency of that package, so it could not resolve there.

## Findings that are just work

- **A `Textarea` in cells is not controlled, and the kit's is.** The renderable owns an edit buffer:
  `initialValue` is read once, its change event carries no payload — OpenTUI's own comment says to ask
  the renderable for the text — and a `value` that changes from outside, which is Notes opening a
  different note into the same box, has to be written in. So the TUI's `Textarea` keeps a handle on what
  it drew and writes back only on a difference, or every keystroke would rewrite the buffer under the
  cursor. It is the only kit node here that needs a handle, and phase 1 should expect `Input` and the
  composer to want the same thing.
- **Enter has to be routed to a row's `onPress`.** On the DOM a `Row` is a button or an anchor, so Enter
  on the focused row raises a click and `onPress` runs by itself; `Rows.onActivate` is the other way of
  saying it and most panes use neither. There is no element here, so a row hands its press to the
  collection and the intent routes it. Phase 2 owns this when `collection.ts` splits.
- **A control has no intrinsic width in cells.** `Input` needs `flexGrow` or it draws three characters
  wide and scrolls its own content. The kit's `width` role is not a number and should not become one;
  the host decides that a field takes the room its row has left, which is what the stylesheet decides on
  the DOM.
- **`Markdown` is drawn as wrapped text.** OpenTUI has a native `markdown` renderable and phase 1 should
  use it, but it requires a `SyntaxStyle`, which means tree-sitter assets and a decision about which
  theme styles them. That decision belongs to the appearance layer, not to a spike.
- **`Row`'s `reveal` has no meaning.** It hides the trailing controls until hover. There is no hover, so
  they always show. Worth a line in the node's row in `docs/ui-design.md § Every node at 80 by 24`.
- **`Markdown`'s `onClick` takes a DOM `MouseEvent`.** It is not one of the kit's eleven events and a
  terminal cannot raise it. `onSelect(href)` beside it already is the portable one. Worth a look in
  phase 1 at whether `onClick` should exist at all.
- **`Input`'s `ref` is typed `HTMLInputElement`.** Notes uses it to put focus on the title after a
  create. On this host a ref hands back a renderable. The pane is asking for something reasonable —
  "focus what I just made" — and the kit should answer it as an intent rather than as an element.
- **`fleet.ts` imports `idb-keyval` unconditionally**, so the package has to be installed even for a host
  that never persists. The persister itself is only built by `clientFor`, which the TUI does not call.
  Phase 3 puts a file-backed persister behind it.
- **A transport alone is not enough to reach a node.** With no `fleetList`, `selectActiveNode` reports
  ready with nothing selected and every request falls through to apiClient's same-origin path, which in
  Node is a relative URL with no origin. The TUI supplies `fleetList` returning its one node.
- **The reconciler warns "Renderable with id box-25 was already destroyed, skipping add"** when a
  `Show` or a `Suspense` swaps its children. Cosmetic on this tree, but it is the reconciler saying it
  was handed a node it had already torn down, and phase 1 should find out which swap does it before
  fifty more nodes are written against the same pattern.
- **`textBufferViewSetViewport` throws `Argument 3 must be a uint32`** once per mount on this tree,
  under Node's FFI, without stopping the render. Not chased. It is consistent with OpenTUI's Node lane
  being newer than its Bun one, and phase 1 should watch whether it survives a version bump.

## What phase 0 did not find

No node had to read the terminal's width. No node needed a prop the kit does not carry. No key failed to
map to an intent. `list-detail`'s written projection was right as written. Nothing in the kit had to
change for a terminal to draw it, which is the result this phase existed to get.

## The screenshot

`pnpm --filter @acorn/tui capture`, at 80 by 24, against the fixture in `apps/tui/src/fixture.ts`:

```
acorn · fix-login · notes
acorn filter…                   │◀ Scratchpad             ◆ task [x] [Preview]
TASK 3 +                         Whatever is in hand.
  [x] Scratchpad ✕
  [x] Repro steps ✕
  [ ] What the agent found 🤖 ✕
WORKSPACE 1 +
  [x] Conventions ✕
GLOBAL 0 +




                                 21 B                          view in Context →
j/k move · enter open · q quit
```

Against a real node it is the same screen with your own notes in it:

```
pnpm dev:node                                    # copy its first line, which is JSON
ACORN_NODE_HANDSHAKE='<that line>' pnpm --filter @acorn/tui dev
```
