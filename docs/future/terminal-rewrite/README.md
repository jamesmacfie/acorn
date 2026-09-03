# Terminal rewrite: acorn draws its own cells

A programme, 2026-09-03. Nothing here is scheduled and nothing in it has started. It was written
against commit `9e5d90ca`, which is the baseline every line number in the folder refers to. Where a
file here disagrees with [tui.md](../../tui.md), the owning doc wins until a phase ships and moves its
behaviour there.

## The decision in one paragraph

The terminal client keeps Solid, keeps client-core, keeps the closed kit, and keeps every one of its
75 node components and eight layouts. It stops using OpenTUI. In its place the client owns four small
things: a tree of plain objects that Solid mutates, a layout pass over that tree using the same Yoga
engine OpenTUI uses but through its WebAssembly build, a paint pass that writes the tree into a cell
buffer and flushes the difference from the previous frame, and an input parser that turns bytes from
the terminal into key and mouse events for one dispatcher. Focus becomes a value the region store
holds, not a property a renderable has. The pseudo-terminal rectangle moves from OpenTUI's embedded
emulator to `@xterm/headless`, which three packages in this repo already depend on.

## Why

Three findings from the review in [review.md](./review.md), each with the evidence behind it:

1. **Every documented rendering fault is OpenTUI's retained-node lifecycle meeting Solid's.** A
   renderable is destroyed a tick after it detaches, which blanked every `Suspense` boundary that
   suspended twice. Yoga hands an unmeasured node `NaN` and the Zig side throws on it from inside the
   render loop, which ended the process. A bare string under a box throws from inside a signal write.
   A `span` drops its colour prop and drew every diff line white on white. The four are patched at the
   boundary (`apps/tui/src/kit/reconciler.ts`, `apps/tui/src/renderGuard.ts`, `apps/tui/src/kit/roles.ts`,
   `apps/tui/src/appearance.ts`), each patch is pinned to version 0.5.9, and each must be re-verified
   on every upgrade.
2. **Every documented navigation fault is two owners of focus.** The region store in
   `apps/tui/src/keys/regions.ts` has a sound design, the same context-stack model lazygit uses. But
   the renderer owns the actual focus, `visible` is per node, and `focus()` and `blur()` are silent
   no-ops on a node that lost its `focusable` flag. The load-bearing assertion in
   `apps/tui/src/reachability.test.tsx` is that the renderer and the store name the same renderable,
   and about 40% of the client's 34 commits are repairs of that disagreement. The store is 1,071 lines
   because it reconciles two owners.
3. **The runtime floor is wrong for this repo.** OpenTUI reaches a 6 MB Zig library through
   `node:ffi`, which needs Node 26.4 with `--experimental-ffi`. The monorepo pins 24.11.0 in
   `node-runtime.json`. On the repo's own Node every drawing test skips, and shipping `acorn` means
   bundling a second runtime. The library is Bun-first, pre-1.0, released ten times between
   2026-08-03 and 2026-09-01, and pins an exact solid-js version.

The alternative you might expect, a Rust or Go renderer in the style of yazi or lazygit, is refused in
[refused.md](./refused.md). Client-core and every plugin are TypeScript, so Solid keeps running in
Node whatever paints the cells. A compiled painter behind a wire would give us two runtimes and a
serialization step on every frame, and none of the single-process speed those apps get from having
model and paint in one binary.

## What does not change

The kit contract is untouched: 75 nodes, six role enums, eleven event names, `NODE_SUPPORT`,
`NODE_FOCUS`, the eight layouts, the tree protocol in `packages/protocol/src/tree/messages.ts`. No
plugin changes a line. The desktop host changes nothing. The keyboard model in
[tui.md](../../tui.md) § Keys and focus keeps every rule; what changes is the mechanism under it.
The test suite keeps its scenarios; what changes is the harness they drive.

## The files

- [review.md](./review.md) is the evidence: what the client is, where each fault came from, what the
  five reference terminal apps do differently, and the three options weighed.
- [architecture.md](./architecture.md) is the target: the four layers, the invariants that hold
  between them, and what each replaces.
- [phases.md](./phases.md) is the order of work and the dependency graph.
- Six phase files, each written for a reader with none of this context. Each names the code it touches,
  the tests that prove it, the docs it owes, and what to verify before starting.
- [refused.md](./refused.md) is what the programme decided not to do, so it stays decided.

## The phases, in one line each

| Phase | What it is | Status |
| --- | --- | --- |
| [0](./phase-0-baseline-and-spikes.md) | Golden frames of every pane and the shell at two sizes from the current renderer, the reachability suite pinned as the acceptance property, and four spikes that decide the design's open questions. | Not started. |
| [1](./phase-1-one-owner-of-the-keys.md) | The region store becomes the only owner of focus, the keymap engine reads it through a host adapter of ours, and OpenTUI's focus is reduced to a cursor. Ships on its own and ends the navigation class. | Built 2026-09-03. Four false premises and the second reveal's stay of execution are recorded at the bottom of the phase file. |
| [2](./phase-2-the-painter.md) | The node tree, the Yoga pass, the cell buffer, the diff, and the flush, behind a build switch so both painters run against the golden frames. | Waits on phase 0's spikes 2 and 3. |
| [3](./phase-3-widgets-and-the-pty.md) | The scroll viewport, `Input`, `Textarea`, mouse hit testing, and the `pty` rectangle over `@xterm/headless`. | Waits on phase 2. |
| [4](./phase-4-cut-over.md) | Remove OpenTUI, the FFI gate, the Node 26 floor, and the seven workarounds; rewrite the test harness; move the behaviour into `docs/tui.md`. | Waits on phases 1 and 3. |
| [5](./phase-5-what-the-reference-apps-do.md) | The few conventions the reference apps have that we lack, taken up against the keyboard rules rather than copied. | Independent of the rest. |

## Done when

- `acorn` runs on the Node the repo pins, with no flag, and `pnpm --filter @acorn/tui test` draws on
  that Node instead of skipping.
- No package under `apps/tui` depends on `@opentui/core` or `@opentui/solid`. `@opentui/keymap` may
  stay: it is pure TypeScript, the desktop drives the same engine, and phase 1 replaces only the host
  adapter it is built from.
- `apps/tui/src/reachability.test.tsx` passes with invariant 9 rewritten from "the renderer and the
  store agree" to "there is one focus value", because there is nothing left to disagree with.
- Every golden frame from phase 0 matches, or the difference is a listed and accepted change.
- The seven workaround sites named in finding 1 are deleted, not adapted.
- [tui.md](../../tui.md) § The runtime floor, § The host switch, § Rendering, and § Keys and focus
  describe the new mechanism, and this folder is deleted with a paragraph in
  [../README.md](../README.md) § Retired folders saying where each part went.

## How this relates

[performance.md](../../performance.md) § 2026-09-03 — phase 9
indexes the region store's walks and windows the diff pane. Its indexing half is subsumed here: phase 1
rewrites the walks over a tree the store owns, and the arrays it would index become maps by
construction. Its windowing half stands and should be done after phase 4, against the new painter.
[performance.md](../../performance.md) § 2026-09-03 — phase 4
shipped and is unaffected: it is about what loads before the first frame, not what draws it.
[bundle.md](../bundle.md) § Ordering step 7 ships `acorn` in the node tarball, and today it carries a
runtime pin that this programme removes; the step gets simpler, not different.
