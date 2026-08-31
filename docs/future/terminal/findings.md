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

`pnpm --filter @acorn/tui capture`, at 80 by 24, against the fixture in `apps/tui/src/fixture.ts`.
Redrawn after each phase that changed what is on screen. The caret is the visible half of what phase 2
built: the pane opens with the keys somewhere, rather than with focus nowhere and a list nobody can
drive.

```
acorn · 1 task                                                       fix-login ●
›◉│  [Notes]
  │acorn filter…
  │
  │TASK 3 +
  │  [x] Scratchpad                                                            ✕
  │  [x] Repro steps                                                           ✕
  │  [ ] What the agent found                                               🤖 ✕
  │
  │WORKSPACE 1 +
  │  [x] Conventions                                                           ✕
  │
  │GLOBAL 0 +
  │
  │
  │
  │
  │
  │
  │
  │
  │
  │
j/k move · enter open · ctrl+k commands · ? help · w switch workspace · ctrl+…
```

Redrawn again after phase 4, which is the first frame with a shell around the pane: a topbar naming
the workspace, the task count, the open branch and the node's state; a rail collapsed to a strip of
marks, because 80 cells is under the 100 the names need; the pane strip; and a footer read off the
keymap's active layers. What is in the middle is the same Notes, still unchanged.

Two things that frame shows and are worth saying out loud. The chrome spends three cells, so at 80
columns the pane is 77 and `list-detail` is under its own 80-cell threshold: one group at a time, with
`expand` switching between them, which means opening a note does not reveal it until you press `l`.
And that 77 is what every pane in the roster inherits, so it is where the phase 6 sweep will find most
of its work.

Redrawn a third time after phase 6, which is the first frame with the whole roster registered. The
fixture task carries a repo and a pull request now, so the pane it opens on is the one the task's own
layout puts first — and `capture` takes a pane name, so any of the eight is one argument away:

```
acorn · 1 task                                                       fix-login ●
 ◉│  [PR review]  Agent  Changes  Notes  Context  Editor                        
──│PULL REQUEST                                                                 
› │#42                                                                          
  │Invalidate the old password on reset                                         
  │State     [open]                                                             
  │Author    [JA](jamesmacfie)                                                  
  │Branch    (fix-login) → (main)                                               
  │Files     2 · +16 −3                                                         
  │Updated   689mo ago                                                          
  │Reviewers none requested                                                     
  │                                                                             
  │[ squash ▾ ] [Merge] [Close] [Convert to draft]                              
  │                                                                             
  │▾ Description ⧉                                                              
  │  Loads the account first so the stored hash is the one being checked.       
  │                                                                             
  │▾ Labels 0                                                                   
  │  None.                                                                      
  │  [ Add label… ▾ ]                                                           
  │                                                                             
  │▸ Checks 2 ●                                                                 
  │src/session.ts                                                         ++4 −0
j/k move · enter open · ctrl+shift+f find in files… · ctrl+0 go to github in …  
```

Two things in that frame are the sweep's own findings. The last content row is the detail column
bleeding into the list column's last line, which is where clipping lands when a pane is taller than the
screen. And `Files 2` is a count rather than the two names: the navigator's folds open by default and
run past row 24, so at 80 cells the file list is a scroll away. Neither is worth a press on every host
to fix.

Against a real node it is the same screen with your own work in it. Phase 0 was handed a node's boot
line in an environment variable; since phase 3 it finds one itself:

```
pnpm --filter @acorn/tui dev
```

## What phase 1 did with these

Shipped 2026-08-31. Which of the above is closed, and which moved.

Closed:

- **The element-typed props.** `slot()` lives in `apps/tui/src/kit/cells.tsx` and every node with a
  `leading`, `trailing`, `meta`, `actions` or `icon` goes through it. It stayed the host's problem, as
  this file argued: no pane changed.
- **`Markdown`'s `onClick`.** Gone from the kit. Its two callers wanted the href and the browser on a
  miss, so `onSelect` returns `false` for "not mine" and both callers now spell that. See
  `docs/ui-design.md § What a terminal renderer needs from this`.
- **`Row`'s `reveal`.** Its row in the 80×24 table now says the trailing controls always show.
- **The `Textarea` handle.** `Input` wanted the same one, exactly as this file predicted, and has it.
  The composer will want it too and gets it through `Textarea`.
- **A control has no intrinsic width.** `Input` takes the room its row has left unless its `width`
  role says `narrow`. The role stayed an enum.

Moved, with the reason:

- **`Markdown` does not use OpenTUI's `markdown` renderable.** That renderable needs a `SyntaxStyle`,
  which means tree-sitter assets in the bundle and a decision about which theme styles them — the same
  blocker this file recorded, and phase 1 had no better claim on it than phase 0 did. What it does
  instead is run the source through the shell's own `renderMarkdown` and turn that HTML into runs of
  styled text (`apps/tui/src/kit/markdown.ts`), so both hosts agree on what markdown *means* and differ
  only in how it is painted. Two markdown readers would drift on the first edge case anybody reports.
  Revisit when the appearance layer has a syntax theme, which is the same decision `CodeBlock` and the
  diff viewer are waiting on.
- **The `already destroyed` warning.** Not chased. It did not reproduce in the per-node suite — 74 node
  cases, every one of them mounting and tearing down `Show`, `For` and `Index` — so whatever swap does
  it is in the pane path rather than in a kit node. Phase 2 owns the layout mount path and is the right
  place to find it.
- **`textBufferViewSetViewport` still throws once per mount** on Node 26.8.1 with `@opentui/core`
  0.5.9, without stopping the render. Still not chased, still consistent with OpenTUI's Node lane being
  newer than its Bun one. Phase 7 pins the version and is where a bump gets tested.
- **`Input`'s `ref` typed to an element.** Still open. The TUI's `Input` takes `ref?: unknown` and
  ignores it, so a pane compiles and does not get its focus. The kit should answer "focus what I just
  made" as an intent rather than as an element, and that is a focus decision, so it goes to phase 2
  with the rest of them.

## What phase 2 did with these

Shipped 2026-08-31. Which of the above is closed, and which moved.

Closed:

- **The pane registry draws DOM layouts.** The layout table is host-supplied now, through
  `client-core/src/host/layouts/table.ts`, the same seam `KIT_COMPONENTS` already had one of. The DOM's
  table is the fallback, so nothing on the desktop changed, and the `??` short-circuits so a host that
  supplied a table never reaches for the other one. `apps/tui/src/App.tsx` draws Notes through the
  pane's own component and the cast is gone.

- **A pending `lazy()` region is an empty string.** Every region is under a `Suspense` in the mount
  path, as the finding asked, and so is the layout — which is a `lazy` for exactly the same reason and
  was the one that actually broke the mount, because phase 0 never used the registry's component.
  `fallback: null` on both, which is the same nothing the DOM rendered before.

- **`Input`'s `ref` typed to an element.** Still `ref?: unknown` and still ignored, and that is now a
  decision rather than a gap: a row hands its renderable back through `ItemProps`, which is the kit's
  own opaque object, and "focus what I just made" is answered by the collection rather than by handing
  a pane an element it would have to know the type of.

- **Enter has to be routed to a row's `onPress`.** `ItemProps` carries the press. A row registers its
  handler with its collection as it draws, and `activate` routes it, so a pane that spells neither
  `onActivate` nor `onSelect` still opens on Enter.

- **The `already destroyed` warning.** Not seen once across 111 cases, including every layout swapping
  its regions and a modal mounting and unmounting over a live list. Phase 1 guessed it was in the pane
  path; the pane path is now the registry's own and the warning is gone with the workaround that stood
  in for it.

Found here, and worth knowing:

- **A border role is not a brightness.** Drawing an entered rectangle with a `control` border and an
  idle one with `surface` made the box vanish on entry, because a style pack may set any role to zero
  width and `control` is one it sets. The role stays `surface` either way and the colour carries the
  state. Same trap as the one in `docs/ui-design.md § Borders`, met from the other side.

- **A box title that does not fit is not drawn at all.** `Terminal · esc leave · esc esc send escape`
  is 44 cells and the box was 40, so the title came back empty rather than truncated. Titles are short
  and the full rule belongs on the footer, which phase 4 draws from the active layers.

- **`_resetCollectionState()` never reset anything.** `setStates(() => ({}))` on a Solid store *merges*
  the object, so the seam was a no-op and a suite's second test inherited the first one's caret. It is
  `reconcile({})` now. This is client-core's own seam and the DOM suite could not see it, because each
  jsdom test file is a fresh module graph and the terminal's whole suite is one process.

- **`mockInput.pressKey` takes OpenTUI's own spelling.** `'F6'` is F6 and `'f6'` types two letters.
  The same trap phase 0 wrote down for `RETURN`, met again, and the reason `renderCells` waits a real
  80ms after a key: a lone Escape is the start of every escape sequence there is, and the terminal's
  parser holds it until it is sure nothing follows. Flushing the render loop does not make that timer
  run.

- **`registerBindingFields` is per host and easy to forget.** The DOM installer registers the `active`
  field so a bare-key binding can say "not while somebody is typing"; the terminal's did not, and the
  engine's answer was a `[unknown-binding-field]` warning on stderr and a `j` that walked the list from
  inside a filter box. Any third host owes the same line.

## What phase 3 did with these

Shipped 2026-08-31. Phase 3 is process and custody work, so only two of the findings above were its
to close, and both are.

Closed:

- **`fleet.ts` imports `idb-keyval` unconditionally.** Storage is a seam now, `setCacheStorage`, and
  the TUI installs a directory of files under its config root before `selectActiveNode` builds the
  first cache (`apps/tui/src/node/cache.ts`). The import stayed static: dropping it would take a
  dynamic `import('idb-keyval')` on every read and write, which costs more than the dependency does.

- **A transport alone is not enough to reach a node.** Still true, and now `fleetList` is the real
  fleet store rather than one hard-coded record, with `probe`, `pair`, `rename`, `forget`,
  `reconnect` and `restartLocal` beside it.

Found here, and worth knowing:

- **`ServiceHost` could not be imported, and the phase file said it could.** The plan read
  "`packages/custody/src/supervision/` owns spawning the node, parsing the handshake, and the bounded
  drain. Import it." It owns none of those for this caller: `ServiceHost` drives `service.js` over an
  fd-3 RPC channel opened before the service binds anything, and a standalone node announces itself
  with one JSON line on stdout and speaks no RPC at all. Two protocols in one class would be worse
  than the forty lines in `apps/tui/src/node/supervise.ts`, and the part worth sharing — SIGTERM then
  SIGKILL after five seconds — is six of them, copied with the reason.

- **`ws` resolves to its browser stub in this pipeline.** `ws` publishes a `browser` export condition
  whose entire body is a throw, and something between vite's SSR resolver and the TUI's config picks
  it, so `new WebSocket(...)` fails with "not a constructor" — after the HTTPS half of the very same
  connection worked, which reads as a broker bug and is not one. `vitest.config.ts` aliases `ws` to
  the file `import.meta.resolve` gives it. It cannot be fixed in `vite.config.ts`, because the bundle
  leaves `ws` external and `ws` exports its root and nothing else, so a deep specifier would not
  resolve at runtime.

- **Attaching to a node the desktop started needs a pairing code.** The design left this open between
  the pairing banner and a new loopback mint route. It is the banner: `acorn` prints the node's pid
  and the `kill -USR1 <pid>` that reopens the window, then runs the same three steps `--node` does
  against loopback. That reuses every line of the remote path and adds no trust. The mint route stays
  a door.

- **`openDataFolder` has nowhere to open.** A terminal has no file manager, so the recovery seam's
  first action prints the path — on the way out, registered as a `process.once('exit')` line, because
  the renderer owns the screen until then and anything written under it is drawn over before anyone
  reads it.

- **Two things the phase scoped and did not build, both for want of a consumer.** `nodeAdopt` is not
  installed, so `fleetBridge().adopt` throws its "this build cannot adopt provided nodes" — an honest
  product state the seam already models, and there is no surface to reach it from until phase 4.
  Tunnels were out of scope and remain so.

## What phase 4 did with these

Shipped 2026-08-31. Phase 4 is chrome, so it closed the findings that were waiting on a shell, and
found four of its own.

Closed:

- **`registerBindingFields` is per host and easy to forget.** Still true, and phase 4 met the other
  half of it. The OpenTUI adapter has no compiler for `desc` or `group`, so the command layer's
  bindings carry neither and the footer reads both off the command each binding resolves to.
  Registering them by hand is worse than leaving them out: the engine already has fields under those
  names and says so.

- **A box title that does not fit is not drawn at all.** The rule phase 2 could not fit in a
  rectangle's title, "esc leave · esc esc send escape", is on the footer, which says it while any
  rectangle is entered and says nothing about it otherwise.

- **`Spinner` was static.** The shell starts one interval and every spinner reads the same counter,
  which is what the DOM gets for free by putting the animation in CSS. One timer for the screen, and
  unref'd, so a spinner cannot hold the process open.

- **Nothing drew the fleet.** Every node this device has paired with is a palette row that switches to
  it, re-registered when the fleet changes. That is the surface phase 3 said `nodeAdopt` was waiting
  for; adopting is still not installed, because the row that would reach it belongs to a nodes
  surface and the palette is not one.

Found here, and worth knowing:

- **A terminal cannot press Cmd, and the keymap did not know.** The engine reports the *platform's*
  primary modifier, so on macOS `intentKeys` was handed `super` and `commit` came out as
  `super+return`, a chord a terminal emulator keeps for itself and never delivers. `setKeymap` takes a
  `primary` now and this host says `ctrl`. Any third host on a surface that cannot see the command key
  owes the same line.

- **A `Modal`'s trap swallowed the keys its own contents needed.** Phase 2 reasoned that a collection
  inside an overlay would answer its arrows first "because its layer is focus-within on itself".
  Priority decides, not locality: the swallow sat at 60 and a collection sits at 40, so a list inside a
  `Modal` could not be activated at all. The swallow is at 35 now, above a pane's own layer and below a
  collection's, and a collection behind the overlay still cannot fire, because the overlay took the
  focus.

- **`getActiveKeys` is a snapshot with no signal behind it.** The footer read it in a memo whose only
  dependencies were the width and the node's state, so it drew whatever was true at the render that
  happened to build it: j/k in the suite, where a later render always comes, and the wrong line under
  the capture script, where none does. It reads the focused renderable and the overlay stack now,
  which are the two signals that move the active layers.

- **A theme cannot cross to a terminal yet.** `appearance.ts` expected phase 4 to read the preference.
  A theme in acorn is an id; its colours live in a `:root[data-theme=…]` block in a stylesheet, and the
  only JS reader of those blocks walks the repo from `pnpm-workspace.yaml` and is test-only by
  construction. The terminal keeps its own palette until the appearance layer publishes the tokens as
  data.

## What phase 5 did with these

Shipped 2026-08-31. Phase 5 is the sandbox and custody, so only one of the findings above was its to
close, and it closed it. The rest of what it found is new, and two pieces of it correct the design.

Closed:

- **http and linear have no compiled half.** They still do not, and now that is no longer a reason
  they cannot be drawn: a tree bundle renders here through the same worker host, the same handshake
  and the same mutations the desktop uses, into cells. What stands between them and the screen is a
  built bundle to install rather than anything in this host, which is the pane sweep's and the
  packaged-build's business rather than this folder's.

Found here, and worth knowing:

- **A worker thread's permission grants are its own, and the design said otherwise.**
  [06-isolation.md](./06-isolation.md) reads "`--permission` is process-wide in Node and a worker
  thread inherits the parent's grants", and planned a child process per plugin with the two ports over
  IPC as the fallback. Measured on Node 24.11 and 26: `new Worker(file, { execArgv: ['--permission',
  '--allow-fs-read=…'] })` applies the permission model **to the thread**, and the worker is denied a
  read the parent is allowed. So the worker thread is the answer, the fallback is not needed, and the
  TUI process itself runs with no permission flags at all — which also disposes of the note under
  § The runtime floor above that said the host half would need `--allow-ffi` and `--allow-worker` of
  its own before a plugin worker got none. It needs neither.

- **Node's permission model does not cover the network.** It covers the filesystem, child processes,
  worker threads and native addons. That is the one thing the DOM worker's `connect-src 'none'` gave
  away for free, and without it a bundle could `fetch` the internet directly and route around the
  bridge's whole scope allowlist. It is closable in the sandbox rather than only at rung 3:
  `module.registerHooks` refuses fourteen builtins by name before a stranger's module scope runs, and
  `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource` and `navigator` are deleted. `node:module` is
  on the deny list so a bundle cannot register a hook of its own; `node:worker_threads` so it cannot
  start a thread that inherited none of it.

- **Node transfers a `MessagePort` by reachability, not by a transfer list.** `worker.postMessage(v,
  [portA, portB])` in a browser delivers them at `event.ports`; in Node a port named only in the
  transfer list arrives nowhere at all, and the bridge reads `event.ports[0]` and `[1]`. So the
  factory puts them in the message body under `__ports` and the bootstrap puts them back where the
  bridge looks. That translation, plus a `message` listener and a `postMessage`, is the whole of the
  Web Worker surface a tree bundle needs.

- **A permission grant is compared as a real path.** A grant naming a path that goes through a symlink
  matches nothing, and the worker cannot read the bundle it was started for. On macOS that is every
  path under `TMPDIR`, so the first version of the suite failed with a denial for the file the test had
  just granted. Both grants are `realpathSync`'d.

- **`TreeHost.tsx` was one file doing two jobs**, and the second host is what made that visible. The
  store, the whole-batch pre-flight check, the mutation apply, the prop sanitiser and the coalescer are
  `client-core/host/tree/treeState.ts` now, with no JSX in them, and each host owns a shell over it:
  its own table of components, its own placeholder, and its own answer to when a batch flushes. Two
  copies of that logic would have been two copies of a security decision, which is the one thing this
  folder's "same bridge, new carrier" decision exists to prevent. It also means a bare-Node suite can
  reach the batch rules for the first time.

- **`frames/register.ts` named the DOM's `RemoteTree` and the DOM's layout table.** The same shape of
  finding phase 0 recorded for the compiled pane path, one registry over: the loaded-plugin
  registration pass is host-neutral `.ts` that reached for two DOM modules by name. Both are
  host-supplied now, with the DOM's as the fallback (`client-core/host/tree/table.ts`, and
  `layouts/table.ts` which already existed and this pass was not using).

- **Two bridge verbs had no host-neutral answer.** `copy` was `navigator.clipboard` and `openUrl`'s
  last rung was `window.open`, and there is neither here. `FrameServiceHost` takes an optional `copy`
  and `openExternal` now, so the desktop keeps the browser's answers by omission and this host says
  OSC 52, or prints the value, or names the URL in a notification — because shelling out to a browser
  from a terminal somebody may be reaching over ssh would open it on the wrong machine.

- **A theme still cannot cross, and a plugin frame's context has to say something.** The tree's
  `PluginFrameContext` carries `theme` and `style` for a bundle that paints its own CSS, which is not
  something a tree bundle does. Both are `'terminal'` here, which is honest about what this host has:
  one appearance, and it is the reader's own terminal.

What phase 5 deliberately left:

- **`Slot` has no terminal sibling.** A surface owner reserving a point for another plugin's tree
  reaches it through `@acorn/plugin-api/ui/host`, which is a DOM-heavy barrel this host does not alias,
  and no pane in this host's roster uses one. A tree bundle cannot open a slot at all — `Slot` is not
  one of the node names a tree may emit, by design. So the work is real but it has no consumer until
  the pane sweep registers a compiled pane that owns a point, and it belongs with the rest of that
  barrel's crossing rather than here.

- **A device-held install.** `{ path }` is a form the custody accepts and nothing offers, because
  there is no surface to reach it from. That is `docs/future/client-plugins/`'s phase 0 on this host.

- **Nothing in the roster exercises it end to end.** Every claim above is tested against a bundle the
  suite wrote, because the two plugins that ship a tree bundle, http and linear, are built by the
  packaged-build pipeline rather than by this repo's `pnpm build`. The first real one through this path
  will be found by the pane sweep or by phase 7.

## What phase 6 did with these

Shipped 2026-08-31. The sweep is the phase that put every first-party pane on the screen at once, so
most of what follows is new rather than closed: nothing in the earlier list was waiting on it.

Closed:

- **`Slot` has no terminal sibling.** It has one now, and so does the rest of
  `@acorn/plugin-api/ui/host` — `apps/tui/src/kit/host.tsx`, the third alias in the host switch. Twelve
  names, and each is one of three kinds: a registry or a pure rule both hosts spend unchanged, a
  surface this host already draws its own version of (the palette chrome, the `wizard` layout, the
  remote tree), or a node that is honestly absent and says so on one line (the reference panel's
  task-link control, an inline rectangle).

Found here, and worth knowing:

- **`@solidjs/router` cannot be imported in this process, and it is on the eager path.** `lifecycle.js`
  reads `window.history.state` at module scope, so it throws before a line of ours runs, and github's
  own `index.ts` reaches a router-using module through its PR pane's contribution. Answering that with a
  `history` on the platform seam's `window` is the failure that file's header warns about, so the
  package is removed rather than tolerated: `src/kit/router.ts` is the fourth thing the host switch
  aliases, and it answers the five names the panes ask for with this host's truth — no params, no
  query, nothing matched, and a navigation that does not happen. There is no URL here, which is the
  same answer `RemoteTree` already gave a loaded plugin.

- **A prop type written twice loses a prop, and four of them had.** The terminal kit's components
  carried hand-written prop types, and with the roster in the same tsc program every pane failed to
  compile: `tip`, `iconOnly`, `min`, `width`, `placement`, `Modal.Body`, `Menu.Item`,
  `MentionSegment`. Nobody had noticed, because nothing compiled against them. `ButtonProps`,
  `InputProps`, `SelectProps`, `PickerProps` and `MentionTextareaProps` are exported from the DOM kit
  now and imported by the terminal one as types, which are erased and so keep the barrel rule intact.
  A node's props are one contract; there is one declaration of it.

- **`RowActions` and `Timeline.Turn` were drawn to the wrong shape, and only a caller could tell.**
  `RowActions` takes a render prop over the menu's context, and drawing its children directly handed
  that function to Solid, which called it with nothing and left every item with `context: undefined`.
  `Timeline` had no `Turn` at all, so `Timeline.Turn` was `undefined` passed to `createComponent`. Both
  are cases a per-node test cannot catch: the node draws, and what breaks is the shape of what a caller
  hands it.

- **Nothing in the kit may shrink.** This is the largest thing the sweep found. Yoga answers a height
  deficit by taking it out of every child that will give, and a one-line row given half a line lands on
  the line above it — so the PR pane at 80 by 24 drew as two screens interleaved character by
  character, and the topbar and the rail drew as blank lines. Every block node in `kit/grouping.tsx`
  and every row in `kit/showing.tsx` refuses to shrink now, and the pane's own box clips. A `scrollbox`
  was the other candidate and is refused for a reason worth writing down: its content box is
  free-sized, so every layout that measures its own box to decide whether it is narrow — which all of
  them do — measures a width that is not on screen, and a `list-detail` pane's detail column never
  draws at all.

- **A row of `text` renderables is a row of boxes.** Same cause, one axis over: a wrapped markdown
  paragraph is several styled runs, each of them a box, and at a width they do not fit each one clips
  its own content. "hash but `signIn` still" came out as "hash bsignInstill". A `span` is a run inside
  one `text`, so the line wraps and clips as one thing, and that is what the markdown pass draws with
  (`kit/cells.tsx` § `Run`).

- **`flatten` on a node prints `[object Object]`.** A pane may hand a node that draws a line another
  kit node — a `Row` labelled with a `Text`, a `Fold` counted with a `Badge` — and there is no text to
  read off a renderable. `Line` asks first and draws the tree instead; `Button` asks and draws its
  `label`, which is the words an icon-only button already carries. The changes pane's file rows and the
  context pane's item rows were both `[object Object]` before this.

- **A space role has to answer both axes.** `space.row` and `space.stack` said "0 lines" and nothing
  about cells, which read as zero — so an `Inline gap="row"` glued its children together and the
  context pane's header drew as "context2 sections". Vertically they still spend nothing; horizontally
  the floor is one cell, because two runs of text with nothing between them are one word.

- **Two panes reached for a browser and took themselves down with it.** The PR pane's comment box
  wrote a draft to `localStorage`, which is a flagged builtin under Node and undefined without
  `--localstorage-file`; the editor pane listened for the window's `focus` event to reload a file the
  agent might have changed. Both threw inside a mount, so both drew nothing at all rather than drawing
  without the affordance. The storage half is one guarded accessor now
  (`client-core/kit/lib/deviceStorage.ts`), on `@acorn/plugin-api/client` because a plugin's model is a
  `.ts` file with a node-environment test; four call sites across three plugins moved onto it. The
  focus half is a guard in the pane, because a host with no window has nothing to listen to.

- **A pending `lazy()` is an empty string, again, in the two places phase 2 did not reach.** A browse
  source's component and a pane whose contribution is a bare component rather than a set of regions are
  both mounted by the chrome rather than by the pane registry, and neither had a `Suspense`. Both do.

- **The default source is whichever plugin registered first.** `selectedSource()` resolves an unset
  selection to the default source, which on the desktop is core's own home page and here was github's
  browse — so the shell opened on a repo browser instead of on the reader's work. The composition root
  starts the selection explicitly empty, because this host has no landing page.

- **A row rebuilt under the keys took them with it.** `Rows` draws through `<For>`, which is keyed by
  reference, and a pane's items are a fresh array on every render: any refetch destroyed the row focus
  was on, and on a host with no pointer there is no way to put focus back. A collection re-lands on the
  same key when it sees its holder destroyed.

- **A terminal cannot press Cmd, and a contribution's own chord is a literal.** Phase 4 taught
  `intentKeys` to ask this host which modifier it has. A pane's `defaultChord: 'meta+shift+r'` is not
  an intent, so it came out of `toKeymapKey` as `super+shift+r` and advertised a chord a terminal
  emulator keeps for itself. The command layer reads a leading `super+` as `ctrl+`.

- **The `$EDITOR` handoff needed nothing built, and the design had it wrong.** This file's phase plan
  described releasing the terminal, spawning `$EDITOR` and resuming. The editor pane already had a
  terminal mode: one device preference swaps CodeMirror for a throwaway PTY running the reader's own
  editor, and that PTY is on the node. In cells it just draws. What the phase built instead is
  `attachPty`, which takes the two throwaway PTY callers off xterm and onto a channel description —
  which is what let docker exec cross too.

- **A region offers only its first collection.** The agents sidebar draws approvals above sessions, two
  `Rows` in one region, and the keyboard reaches the first: Tab cycles regions, `j` wraps inside a
  collection, and there is no key between them. A reader with an approval pending cannot reach the
  session list. The desktop has the same structure and a pointer. Left open, and it belongs with focus
  and regions rather than with the sweep.

What phase 6 deliberately left:

- **The read-only text view inside an `editor` rectangle.** The box draws and says the file opens
  there, and the reader's own editor opens in it. Reading a file without leaving the pane is a smaller
  want than editing one, and it needs the find bar wired to a text region that does not exist yet.

- **A settings surface.** Four plugins register a settings page and this host draws none of them, so
  `workflows` contributes nothing here at all. The desktop's settings modal is chrome; this host would
  need its own, which is phase 4's kind of work rather than the sweep's.

- **The chrome at 120 columns with a pane taller than the screen.** Fixed for the panes in the roster,
  and the mechanism is fragile: it rests on nothing in the kit shrinking, and one `flexShrink` left at
  its default anywhere on a pane's path brings the interleaving back. An arch rule over the kit's own
  boxes would hold it; a rule that reads JSX is not a rule this repo has.
