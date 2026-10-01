# Integration with main

This review covers the merge of main at `72ebb8ea4f97500485efbf4d8a47005af235a039`
into the performance checkpoint `12ebac0`. Earlier measurements remain tied to their
recorded source versions. This integration does not establish a new performance gain.

## Preserved contracts

- Main's isolated plugin origins, scoped relay, trusted user gestures, runtime floor,
  and bounded input validation remain in place.
- Modern plugin workers share by plugin ID and bundle hash, with independent pane
  ownership. Legacy workers have one immutable pane each and retire immediately.
  The latter preserves isolation and costs more processes than sharing legacy workers.
- Main's resident diff segments retain the performance work's cancellation and
  generation fences. Removed and reappearing files cannot accept earlier gap results.
- Terminal operations retain approved repository snapshot authorization and the
  performance work's serialized session lifecycle and deferred resource cleanup.
- Docker log and stats streams share upstream work while maintaining independent
  viewer cleanup and main's input limits and error containment.
- Notes retain captured draft ownership and save acknowledgement behavior while
  using main's confirmation component for deletion.
- WebSocket handlers retain main's bounded transport and error containment plus
  negotiated multiplexed viewers. Async handler rejection and failing detach callbacks
  are contained without stranding sibling viewers.
- Cache clearing waits for restoration and outstanding capture, then deletes through
  the partition's captured adapter and serialized queue. It retains visible queries,
  the connected node, and resident diff segments.

- Installed device plugins retain their dynamic preference keys. Storage enumeration is limited
  to installations with those plugins; fixed host preferences still use direct reads.
- The external Node plugin RPC transport loads inside the async isolation factory before worker
  acquisition. The static service graph falls from 3,086,869 to 3,058,450 bytes, passing the
  unchanged 3,062,000-byte ceiling.

## Deferred work

The implementation handoffs in `docs/future/performance` are the continuation point.
Main's memory, dynamic UI, and TUI plans remain design inputs. Resume with fresh traces
and measurements before applying the older audit findings to this merged version.

## Verification

Supported-runtime checks use the exact bundled Node 24.21.0 via a temporary PATH entry.
`pnpm lint` passes (37 Turborepo tasks, including prerequisite builds).

The first Node 26.8.1 suite exposed merge fixtures and a backup timeout. The backup
suite also timed out in isolation on Node 26, while all 12 checks passed on bundled
Node 24.21.0. This review does not resolve the existing Node 26 backup behavior.

Focused merge checks pass: cache lifecycle/fleet 35; WebSocket transport 46;
terminal server ownership/security 30; Docker sharing/security 8; Notes drafts/deletion 9;
diff canvas/gap ownership 10; HTTP tree 14; database tree 11; client followups 48;
terminal selection/removal 5; bundled trust 9; terminal run trust 2. All four real TUI
permission, environment and builtin-import probes pass with the SDK handshake.

The cumulative Node 24 run overlapped repository lint during client tests and hit
loading deadlines. The run finished with 34 of 37 package tasks successful. Client-core, Node composition,
and desktop tasks failed. Desktop's six `src/helper/rendererConnection.test.ts` cases
failed reading the missing `watch` member in the fixture; its boot and Rust stages were
not reached. This is a separate unresolved fixture/contract integration issue, not a
timing failure. Node composition first timed out, then its next test reported
a duplicate GitHub provider. Client failures included document ownership, heavy component
imports and pane layout readiness. These outcomes need replay without contention before
being attributed solely to load.

The user explicitly requested proceeding with the merge and handling remaining failures
later. Further suite replay, a fresh native bundle and merged native smoke checks were
therefore deferred. Earlier native evidence remains bound to the pre-merge checkpoint.
No merged native validation or day-long performance claim is made.

Local logs for follow-up: `/tmp/acorn-merge-tests-node24.log`,
`/tmp/acorn-merge-tests.log`, `/tmp/acorn-merge-lint-final.log`,
`/tmp/acorn-merge-backup-node24.log`, `/tmp/acorn-merge-backup-replay.log`.
All owned cumulative test processes have finished. No new app fixture was launched.
