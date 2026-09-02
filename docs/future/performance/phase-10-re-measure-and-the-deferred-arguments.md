# Phase 10: re-measure, then the deferred arguments

Status: parked behind numbers. Waits on every other phase.

## Goal

The programme ends the way it began: with a measurement. Every phase's done-when line is re-run on
the tree as it stands, the numbers are written next to the ones from 2026-08-31 and 2026-09-02, and
the arguments this programme parked are taken up or refused for good against those numbers.

## Why this phase exists

Several shapes in the reads are wrong on paper and unmeasured in practice. Building against them
before the earlier phases land would optimise a system that is about to change under the fix. Each
item below stays in [refused.md](./refused.md) until a phase 0 measurement, taken after the phase
that touches its surface, moves it out.

## The deferred arguments

- **Binary bodies on the helper wire.** `apps/desktop/src/shell/wire.ts` names the ceiling: base64
  costs a third more bytes and one copy each way, which is nothing until a response reaches tens of
  megabytes. Phase 6 takes binary frames for terminal output. Request and response bodies stay JSON
  until the phase 0 request log shows a body over that line.
- **An incremental transcript projection.** Phase 7 makes the store keyed and the markdown
  incremental. If a long session still rebuilds `buildConversationItems` per event and the profile
  says that is the cost, the projection becomes incremental: a per-turn fold that appends. Not before.
- **Per-key query persistence.** The persister serialises the whole dehydrated cache once per
  five-second window per node. Measure the blob after a week of use. Tens of kilobytes is nothing;
  megabytes means per-key persistence, not a shorter throttle.
- **A per-connection interest model on `/v2/events`.** Phase 5 fixes the two concrete amplifiers at
  their source. The model stays refused until a real multi-node fleet shows broadcast volume that
  filtering at the helper does not cover.
- **The tree host's per-batch costs.** `packages/client-core/src/host/tree/treeState.ts` copies the
  parent map per batch and walks ancestors per entry per `remove`, and
  `packages/client-core/src/host/tree/workerHost.ts` Zod-parses every batch. The whole-batch
  pre-flight is a security decision and stays; the algorithm can be linear (a subtree set per
  `remove`, computed once). Do it when a loaded plugin's tree is measured slow, which needs a loaded
  plugin with a large tree, which the fixture can supply.
- **The reconciler's per-element cost in the terminal client.** `apps/tui/src/kit/reconciler.ts`
  patches every element and wraps every dynamic child. Both fix real bugs. Phase 9's counter says
  whether they cost anything a person can see.
- ~~**The node service bundle as one chunk.**~~ **Settled 2026-09-03, and not by the split.** Its
  evaluation is 293 ms, over the bar, and phase 3 refused the per-plugin split anyway: only 51 ms of
  that is the bundle's own modules and every plugin's `init` runs on every boot, so 16 chunks would
  evaluate the same 51 ms. The other 242 ms is external libraries, `drizzle-orm` alone being 161 ms and
  not narrowable (refused.md § Splitting the node service bundle into per-plugin chunks). Two sized
  candidates are left if anyone wants 35 ms: `@agentclientprotocol/sdk` at 25 ms and `jose` at 10 ms,
  both imported statically for work that happens long after the listener is up.
- ~~**The ten SQLite opens per boot.**~~ **Settled 2026-09-03: a non-issue.** `core.sqlite` opens and
  migrates in 7 ms, the nine plugin files cost 23 ms together, and no journal check should be added.
  The 111 ms the `migrate` label used to report was `diskBlobCache` chmodding 2,975 files inside the
  same step, which phase 3 fixed.

## Done when

- Every earlier phase's done-when numbers are re-measured and recorded in this folder's README beside
  the originals.
- Each argument above has moved to a phase file or to refused.md with the number that decided it.
- The folder is deleted and its behaviour lives in the owning docs, the way every retired programme in
  [docs/future/README.md](../README.md) ended.
