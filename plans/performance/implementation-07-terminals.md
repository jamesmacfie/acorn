# Unit 07: Terminal retention and process lifetime

Unit 07 implements the three selected findings in [the terminal audit](./04-terminals.md), including
PTY attachment, callback, output timer, and agent-submit timer retirement. Production changes,
focused verification, and paired evidence are complete for coordinator review. Cumulative desktop,
whole-repository, native, and sustained-use gates remain coordinator work.

## Ownership and contracts

The Node terminal engine owns sessions, raw output, the roster, and PTY attachments. A declared
run-target service owns task/target operation admission and its session index. Authenticated routes
and capability callers retain their authorization boundaries. The protocol, broker, client roster,
and retained xterm consume the engine's events and output. Their schemas, viewer leases, restore
ordering, Node origin, and four-WebGL-context policy remain intact.

The coordinator accepted the teardown and concurrency proposal before edits. The implementation
keeps ownership in the terminal server modules rather than the Node or app entrypoint. The terminal
engine was already a large singleton module; its related map, boot, persistence, and PTY invariants
remain together. No plugin/runtime boundary, schema, credential, canonical tail size, or future
architecture was changed. Future remote clients can consume the same narrow roster events.

| Owner | Files | Change |
| --- | --- | --- |
| Raw output | `plugins/terminal/src/server/terminalUtils.ts` | Keep at most 64 lazy 4 KiB blocks, move a byte cursor in constant time, copy an oversized suffix into owned storage, and decode joined requested bytes once. A complete aligned 4 KiB callback adopts its internally created exact-size Buffer. No caller Buffer is accepted or shared. |
| Run targets | `plugins/terminal/src/server/runtime.ts` | Reserve per-key operation identity synchronously, join adjacent Starts, order Stop and Restart, release settled identity, check disposal after dependencies, reject failed stop replacement, handle exit before spawn returns, and fence discovered URLs after stop/replacement/disposal. Literal NUL characters are spelled as equivalent `\0` escapes. |
| Internal retirement | `plugins/terminal/src/server/runChannel.ts` | Require an attachment-retirement method distinct from destructive session kill. It is an internal engine seam, with no added plugin authority. |
| Session engine | `plugins/terminal/src/server/terminal.ts` | Capture boot/core/database/callback ownership, quarantine durable admission, publish structural roster changes, drain callbacks/timers/waiters, close ordinary attachment children, preserve durable tmux work, and settle teardown independently of another exit event. |
| Agent delivery | `plugins/terminal/src/server/agentSend.ts` | Own delayed submit timers per session, cancel on clear, remove completed ownership, and fence uncancellable late callbacks by stable session identity. The engine supplies a stable WeakMap facade with retirement and map-identity guards. |
| Owning documentation | `docs/terminal.md` | Document byte blocks, operation ordering, roster publication, admission custody, process retirement, and teardown results. |

### Admission and teardown

Configuration, repo trust, hooks, and spawn run under the task/target operation owner. Joining is
limited to adjacent Starts. A Start after a queued Stop or Restart cannot borrow an earlier promise.
Unrelated keys continue concurrently. Failures and vetoes release identity for explicit retry. A
fallback Restart permits an absent cold start, but preserves a failed explicit stop result. A failed
kill that leaves its process live restores the instance so a following Start cannot create another.
Natural exit and explicit Stop publish one target exit transition. Disposed queued work does not run.

Generic create, setup, run glue, reconciliation, and archive reads capture the originating boot's
services. Awaited completion cannot use a replacement core or database. PTY output and exit callbacks
also check the session and boot identity. An already started database operation keeps its captured
handle and reports failure rather than redirecting a write. Idle activity, sends, roster reads, and
stream/task lookup cannot expose a session still awaiting durable insertion. If a tmux process exits
while its insert is held, admission records the final exited state after the insert completes.

Every successful create publishes at the engine owner. Removal publishes once after the memory
change, even when durable deletion rejects. Task drop attempts all durable deletions and publishes
once for the changed batch. Unknown removal emits nothing. Setup, run-target, and teardown wrappers
no longer add duplicate creation events. Narrow working/idle events and human-rate worktree events
retain their separate channels.

Ordinary engine disposal removes listeners, output and submit timers, display sinks, and waiters,
then closes its owned PTY child. For tmux, that child is an attachment; the detached server session
and metadata survive. An ephemeral PTY is terminated. Explicit Stop/kill/removal retains destructive
tmux semantics. Removal retires display sinks and callbacks even when an individual disposer or
its diagnostic logger throws.

Fresh failed tmux admission has a separate rollback rule. The engine verifies row absence through
its captured database before killing only the generated UUID session. A successful insert followed
by retirement preserves durable work. A post-commit rejection or a database that cannot establish
absence preserves the tmux session and emits an unconfirmed-admission diagnostic. The latter can
leave unreturned durable work requiring reconciliation or owner recovery; it is not a zero-orphan
guarantee. Reconciliation failure closes only its new attachment and preserves the preexisting row
and session. The real failure test exercises the compiled direct SQLite adapter, with its migrated
fixture database set to readonly.

Teardown owns a session waiter and deadline. Removal or disposal settles with a null exit code and
the retained tail. A missing exit event at the deadline cannot strand the promise: the engine stops
the process, releases callback handles, and retains an exited timeout history row with a null code.
That row can restore its output without a live producer. Normal natural-exit history also remains
restorable. The agent paste still precedes the 150 ms delayed submit; cancellation removes that timer,
and old callbacks cannot submit into a replaced or retired session.

## Source and evidence provenance

The [final v2 manifest](evidence/unit07-final-source-manifest-v2.json) records 19 production, test,
and probe hashes. Its seven production entries include the unchanged display owner used by the
probe. [The initial manifest](evidence/unit07-final-source-manifest.json) remains preserved. V2 adds
the aligned-block path, held URL fences, private idle admission checks, failed reconciliation
cleanup, and agent-submit ownership. Source was frozen before the final v2 probes. All 19 hashes
matched at the handoff check.

The cumulative pre07 snapshot is `/tmp/acorn-perf-unit07-before`. Its source hashes are in
[the before manifest](evidence/unit07-before-source-manifest.json). Agent delivery was unchanged when
its separate [before source](evidence/unit07-agent-send-before-source.json) was captured. No prior unit
was restored wholesale, and no branch or commit was created.

Final paired results use these artifacts:

- [Cumulative Node before](04-node-results-unit07-cumulative-before.json) and
  [final Node after](04-node-results-unit07-final-after-v2.json): actual ring, run service, installed
  xterm/headless, and display. The lifecycle process seam is injected.
- [Engine before](04-engine-results-unit07-cumulative-before.json) and
  [final engine after](04-engine-results-unit07-final-after-v2.json): actual engine with recorded PTY
  and database boundaries.
- `evidence/unit07-ring-{4096,8,1}-before.json` and
  `evidence/unit07-ring-{4096,8,1}-after-v2.json`: isolated-process ring samples, with exact owner hash.
- `evidence/unit07-ring-4096-{before,after}-ordinary-{1,2,3,4,5}.json`: five isolated ordinary-output
  samples per side, using the preserved before owner and final ring bytes.
- [Submit before](evidence/unit07-agent-send-before-v2.json) and
  [submit after](evidence/unit07-agent-send-after-v2.json): one real timer, cancellation, and writes.

The initial `unit07-ring-*-after.json`, `04-node-results-unit07-final-after.json`, and
`04-engine-results-unit07-final-after.json` are superseded intermediate evidence. They remain on
disk and do not supply final v2 claims. The initial inline submit observation remains preserved.
The original multi-ring Node probe has GC interaction between successive rings, including negative
heap deltas and backing-storage deltas of zero. Use isolated-process artifacts for retention claims.

## Measured changes

Measurements use Node 24.11.0 on Darwin arm64, synthetic inputs, and explicit garbage collection.
The isolated ring probe loads the production owner and checks the full exact 262,144-byte tail.
These are workload measurements, not application RSS, visible UI latency, or a day-long profile.

| Callback size | Heap delta before → after | ArrayBuffers delta before → after | Overflow CPU before → after | Overflow wall before → after |
| --- | ---: | ---: | ---: | ---: |
| 4,096 B | 18,824 → 25,280 B | 262,160 → 262,160 B | 0.095 → 0.063 ms | 0.050708 → 0.060041 ms |
| 8 B | 3,730,424 → 82,192 B | 262,160 → 270,352 B | 106.087 → 2.233 ms | 102.215 → 0.505833 ms |
| 1 B | 30,435,848 → 83,344 B | 2,097,168 → 442,384 B | 1,641.370 → 1.273 ms | 1,635.316 → 0.942916 ms |

The overflow workload is 32 KiB for 4,096- and eight-byte callbacks and 8 KiB for one-byte stress.
Eight-byte retained heap falls 97.8% and overflow CPU falls 97.9%. One-byte stress heap falls 99.7%
and overflow CPU falls 99.9%. The one-byte result is a stress case. The audit's real PTY probe
established that eight-byte callbacks are reachable; it did not measure provider distribution.

The ring owns at most 262,144 bytes of block backing and 64 block references. Process
`ArrayBuffers` deltas also observe transient Buffer pools and GC/native storage timing; the final
one-byte 442,384 B observation must not be recast as 262,144 B. Tests verify the physical block bound,
exact UTF-8 suffixes, block/head cuts, tiny pushes, and oversized input without an oversized retained
backing allocation. Quiet sessions allocate blocks lazily.

Cold fill has a tradeoff. Eight-byte fill wall increases 4.183 → 7.209 ms and CPU 11.963 → 18.893 ms.
One-byte fill wall is 33.292 → 27.649 ms and CPU 48.459 → 40.877 ms. For five ordinary 4 KiB samples,
median fill wall is 0.350833 → 0.381375 ms and CPU 0.585 → 0.809 ms. Median overflow wall is
0.050792 → 0.047625 ms and CPU 0.051 → 0.049 ms. Ordinary retained heap medians are
19,632 → 25,672 B with equal 262,160 B ArrayBuffers. The implementation removes the saturated
tiny-callback cost; it makes no ordinary cold-fill improvement claim.

Eight overlapping target Starts change from eight spawned sessions and seven survivors after Stop
to one shared session and zero survivors. The authoritative instance count is zero after Stop on
both sides. A thousand distinct natural exits still retain a thousand last-exit entries, and disposal
clears them. This unit preserves that history policy rather than imposing a dirty/history cap.

Engine creation notifications change zero → one; create-plus-remove notifications change zero →
two. Removed data/exit callbacks change one each → zero. Disposal attachment kills change zero →
one, and post-disposal output no longer queues a flush timer. Both sides report zero output/idle
timers after engine disposal in that fixture. The separate submit probe changes one timer after
clear → zero, and late CR writes one → zero. Normal 150 ms engine CR delivery is independently
covered by a lasting test.

Installed xterm restoration produces the same 16,633-byte snapshot from the 262,144-byte replay.
The final sample is slower: wall 23.102 → 32.679 ms and process CPU 48.064 → 63.201 ms. The display
owner and parser are unchanged. This single cold sample establishes neither a parsing speedup nor
a visible attach improvement. The held display barrier still sends only ready before settlement,
then reset/snapshot and 1,000 queued frames, and releases its emulator. Its 4,096,000 queued
characters remain an intentionally unselected snapshot-queue policy.

## Regression verification

Final gates pass:

| Command | Result | Durable output |
| --- | --- | --- |
| `rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/plugin-terminal test` | 26 files, 182 tests | [Terminal tests](evidence/unit07-terminal-tests-final.txt) |
| `rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/plugin-terminal lint` | TypeScript passes | [Types](evidence/unit07-types-final.txt) |
| Architecture Vitest command from `tools/arch` | Five files, 67 tests | [Architecture](evidence/unit07-architecture-final.txt) |
| Targeted oxlint on changed production and tests | Zero errors; two nonblocking warnings | [Lint](evidence/unit07-oxlint-final.txt) |
| `rtk git diff --check` on tracked unit files | Pass | Coordinator replay is available. |
| Final source/probe hash check | 19 entries, zero mismatches | [Final manifest](evidence/unit07-final-source-manifest-v2.json) |

The lint warnings are the retained ANSI control-character regex and a test callback snapshot spread.
The first architecture invocation from the repository root selected no files; the corrected owning
working directory passes. No test result relies on that failed invocation.

Lasting added gates cover operation ordering and joining, unrelated concurrency, retry after failure
or veto, failed explicit stop/kill, disposal during each dependency, natural exit before spawn
completion, held URL invalidation, early durable exit, failed/ambiguous insert custody, failed durable
delete, private idle/send quarantine, partial callback registration, failed reconciliation attachment,
throwing disposer/logger, timeout history, and normal/cancelled/replaced agent submit identity.

The actual engine two-reader test removes both display sinks and publishes the roster change. The
client two-reader test uses the actual session store, channel, and held-terminal owner under the
normal browser Solid configuration. It retains both subscriptions and the held terminal after a
failed roster, then clears rows, held ownership, and the final subscription after a successful
removal event. Its API roster is injected; it is a separate consumer gate from the actual engine
fixture, not a two-window native end-to-end claim. Existing same-Node retention, failed-roster,
Node-origin, restore, and four-WebGL tests remain in the passing package suite.

Three real process gates exercise actual engine node-pty children. Ephemeral disposal removes its
child. Tmux disposal removes the attachment child while its fixture-owned detached session and row
survive. Readonly direct SQLite admission removes the fresh session and attachment, with no row or
roster publication. Every tmux invocation selects a synthetic `-S` socket through the narrow fixture
launcher and disables user configuration. The fixture explicitly stops only that server after its
assertions. No default tmux server, normal application profile, paid provider, or external message
was used. All recorded PTY PIDs are awaited dead, and fixture databases/directories are removed.

## Handoff and remaining gates

Source and evidence are frozen. The measurement window is clear: this specialist has no live app,
benchmark, fixture PTY, tmux server, or background build. The coordinator can stage desktop assets,
review cumulative/native behavior, and continue the next sequential unit. This unit does not claim
completion of the broader performance programme or prove several days of stable use.
