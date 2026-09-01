# Rendering lifecycle: what remains after the destroy-race fix

Analysis 2026-09-01. The fix itself shipped and [docs/tui.md](../../tui.md) § Destroy on disposal
owns it. This file holds what the fix deliberately did not do, and the risks a later session should
check before building near it.

## The mechanism, in one paragraph, for whoever lands here first

Reading an uncached query's `data` suspends the nearest `Suspense`. Solid's `Suspense` memoises its
children once: suspending removes them, resolving hands the same instances back. OpenTUI destroyed a
removed renderable one `process.nextTick` later — and nextTick always runs before any promise
settles, so a re-suspended boundary's content was destroyed before even an instantly-resolving query
came back, and `add()` refuses a destroyed renderable and draws nothing. The fix moves the destroy
decision from "removed" to "creating owner disposed", in `apps/tui/src/kit/reconciler.ts`, because
Solid's ownership graph already distinguishes a real unmount (owner disposed) from a suspension
(owners deliberately kept alive). `apps/tui/src/browseSlow.test.tsx` reaches the failing shape via
`ACORN_FIXTURE_DELAY_MS`; the zero-latency fixture cannot.

## Not done, on purpose

**Loading UX.** The fix makes a re-suspended panel come back; it does not change what shows while it
is suspended. `GithubBrowseDetail` wraps `PullDetail` in `Suspense fallback={null}`, so the detail
panel is honestly empty for the length of a fetch. The pleasant version is Solid's `useTransition`
around the TUI router's `navigate` — prior content stays on screen while the next resolves — and it
was rejected *as the fix* because it only covers navigation (a sliding browse window mounts queries
with no navigation anywhere) and masks rather than repairs the destroy. As polish over a correct
base it is fine. Small, self-contained, measurable in feel; do it when a slow connection makes the
blank-while-loading noticeable.

**An upstream issue.** This is arguably @opentui/solid's bug for any re-suspending `Suspense`, and
the override depends on two facts of its dist (0.5.9): `_removeNode` destroys via the node's own
`destroyRecursively`, and the transform's element creation all flows through the exported
`createElement`. File the issue with the browseSlow shape; until it lands upstream, any @opentui
upgrade should re-run browseSlow first.

**Harness teardown.** `harness.tsx`'s `done()` destroys the renderer without disposing the Solid
root, so subtrees detached at teardown are swept only at process exit. Harmless in a test worker;
worth a `dispose()` call in `renderFixture`'s return if test memory ever matters.

## The risk register

- **Retention, not a leak, but watch it.** A node detached while its owner lives is now kept. The
  bounded cases are the designed ones (Suspense re-adds it; disposal sweeps it). The unbounded case
  is a hoisted renderable permanently removed while its component lives on — the author still holds
  the same object, so this matches DOM semantics, but a long-lived screen that churns detached
  subtrees without disposing owners would accumulate.
- **Prompt destroy still matters.** `For`-keyed row rebuilds dispose per-row owners and must go on
  destroying promptly — `keys/collection.ts`'s destroyed-holder refocus exists for exactly that
  rebuild and stays.
- **Coverage gap.** Text nodes and slot children are not owner-tied; a bare slot directly under a
  `Suspense` would re-arm the old bug. No surface does that today.

## Verify before building

- `apps/tui/src/kit/reconciler.ts` — the override still matches the @opentui/solid version in
  `pnpm-lock.yaml` (0.5.9 at time of writing).
- `apps/tui/src/browseSlow.test.tsx` red/green history: it failed before the fix on this exact
  tree; if it stops failing on a revert, the fixture delay is not reaching the queries any more.
- `plugins/github/src/client/GithubBrowse.tsx` — the `fallback={null}` boundaries are the ones the
  transition polish would improve.
