# What the first frame waits for

Date: 2026-09-24. Status: proposal that needs an owner's decision. [Back to the plan](./README.md).

The September programme's second decision was that every host draws first, then connects, then
fills. The desktop window opened on the persisted query cache about 645 ms before the node was
listening. Commit `8c2dbb05` (2026-09-17, "hold startup loader until node is ready") reversed that for
a good reason, and this file proposes a way to get the time back without bringing the bug back.

## What the shell waits for

`apps/desktop/src/client/App.tsx` renders the whole shell behind one gate:

```tsx
<Show when={!nodeGateHolds() && !isRestoring()} fallback={<NodeGate />}>
```

`nodeGateHolds()` in `packages/client-core/src/infra/node/activeNode.ts` holds while fleet selection
runs and while the selected local node has not reported any status. `isRestoring()` holds while the
persisted query cache is read from IndexedDB.

The first condition is the expensive one. The helper's ready line arrives about 45 ms into a launch,
and the node's first status arrives after the node has spawned, evaluated its bundle, booted, and
been adopted by the broker. In the September boot test that gap was 645 ms on a fresh data root, and
the service bundle has grown since ([02](./02-node-boot.md)). Everything in that gap is a loader,
even though the device holds a complete cached copy of the last shell it drew.

The comment on the gate gives the reason: "That keeps pane-owned resources from issuing requests
before their routes exist." Panes mounted from the cache, issued requests to a node that was not
listening, and drew errors.

## F1: Draw the shell from the persisted cache again

**Change.** Treat the bug as a transport problem, because it is one. A request to the supervised local
node while it is starting should wait for it, not fail. Then the gate can go back to waiting only for
the things the shell cannot draw without.

1. **Wait in the transport.** In `packages/client-core/src/infra/node/apiClient.ts`, when the target
   node is the supervised local node and `nodeIsStarting(nodeId)` is true, wait for its first status
   before sending. Use one shared promise per node, resolved by the status push that already releases
   the gate today. Put a ceiling on the wait, such as 15 seconds, after which the request fails the way
   it does today.
2. **Narrow the gate.** Keep holding for fleet selection on a first-ever launch, for an unpaired
   device, and for `isRestoring()`. Stop holding for `activeNodeStarting()`.
3. **Show that the node is coming up.** The node chip already reads "Starting" for this state
   (`packages/client-core/src/features/fleet/NodeChip.tsx`). Make sure it is visible in the top bar
   while the shell is drawn from cache.

With this, the window draws the rail, the top bar, and the last task's layout from the cache as soon
as the renderer has loaded, and pane requests queue behind the node's first status instead of
failing.

**Why at this layer.** The transport is the one place every request passes through, and it already
knows which node is supervised and whether it has reported. Putting the wait there means no pane has
to know about startup, which is the same argument `index.tsx` makes for invalidating active queries
on the first usable status.

**Risks.**

- **Mutations.** A mutation sent while the node starts would wait too. That is better than failing,
  but a person could click **Send** on a stale-looking screen and wait a second. Decide whether
  mutations wait or fail fast. Waiting is simpler, and the chip says why.
- **Streams and sockets.** WebSocket subscriptions already reconnect on their own. Check that no pane
  treats "not connected yet" as an error state it draws.
- **Stale data on screen.** The shell shows cached rows for up to a second before they revalidate.
  That was the September design, and the freshness vocabulary in
  [frontend.md](../../../frontend.md) § Connection and freshness UI covers it.
- **The bug coming back.** Find the resources that failed before `8c2dbb05`, then write a test for
  each one that mounts it against a starting node and asserts it draws its loading state, not an error.
  Ask the author of that commit which panes they were.

**Expected gain.** Everything between the renderer finishing its load and the node's first status.
After [02](./02-node-boot.md) that gap is smaller, but the node still has to boot, so expect a few
hundred milliseconds on every launch.

**Done when.** A launch with a warm cache draws the shell before `service.start` appears in the
helper's marks, and the tests for the previously failing resources pass.

## F2: Measure the cache restore before touching it

`isRestoring()` covers one IndexedDB read. The September programme weighed the blob at 2,194,679 B as
stored (UTF-16), about a megabyte of JSON, with `JSON.parse` at 2.0 ms. Nobody has timed the IndexedDB
read itself in WKWebView. Time it with the `acorn.perf` marks during
[M5](./01-measurement.md#m5-take-the-packaged-numbers-the-september-programme-could-not). If it is
under about 30 ms, leave it. If it is larger, the per-key persistence that September refused becomes
worth measuring. See [refused.md](./refused.md).

## F3: Keep the cache across a weekend

`PERSISTED_QUERY_MAX_AGE_MS` in `packages/client-core/src/infra/persistence/queryPersistence.ts` is 24
hours. Quit on Friday evening and open on Monday morning, and the restore discards everything, so
the first launch of the week draws an empty shell and waits for every request. Every persisted query
revalidates on mount anyway, so an older cache only means older rows on screen for a moment. Raise
the limit to seven days.

The risk is a cached response whose shape no longer matches the code after an update. That risk exists
at 24 hours too, and the rule for it is already written down: bump the query key when a response
type gains a required field.

## Verify before building

- Read `8c2dbb05` and its tests (`NodeGate.test.tsx`, `activeNode.test.ts`) before changing the gate.
  They define the states the gate distinguishes.
- Confirm `nodeIsStarting` is true for exactly the window between launch and the local node's first
  status, and false for a remote node that is offline.
- Confirm `apiClient.ts` is the only path to the node. Plugin frames and trees reach it through
  `frameServices`, which also calls the platform transport, but check.
- Confirm that the cache's `maxAge` applies to the whole persisted client and not per query, before
  deciding what raising it changes.
