# Accepted performance results

Units 01–08 have coordinator review. The user requests a commit at the unit 08 checkpoint.
Units 09–28 and sustained-use validation remain open. This record summarizes accepted evidence, not completion of the task.
Each linked implementation report owns the workload, source/probe hashes, commands, tests, and limits.

## Measured changes

| Owner and workload | Before | After | Evidence |
| --- | --- | --- | --- |
| Unchanged bundled Node reconciliation, median 50 passes | 49.665 ms, eight fsyncs/pass | 11.425 ms, zero fsyncs/pass | [Startup implementation](./implementation-01-startup.md) |
| Cold seven-client bundled custody, median five processes | 96.91 ms, 14 metadata fsyncs | 36.19 ms, two metadata fsyncs | [Startup implementation](./implementation-01-startup.md) |
| Loaded RPC routes, 21,000 calls, forced-GC retained heap | 108.590 MB, completed request functions retained | 22.339 MB, completed request functions released | [Node plugin implementation](./implementation-02-node-plugins.md) |
| Returned telemetry spans, 10,000 rounds, forced-GC retained heap | 33.444 MB | 22.310 MB | [Node plugin implementation](./implementation-02-node-plugins.md) |
| Three rejected plugin reload candidates | Three candidate workers remain after host disposal | Zero candidate workers remain | [Node plugin implementation](./implementation-02-node-plugins.md) |
| Inactive Node burst after a fleet read | 128 forwarded invalidations | Zero forwarded invalidations | [Transport implementation](./implementation-03-transport.md) |
| Exact 8 MiB base64 conversion, median process CPU | 207.621 ms | 1.332 ms | [Transport implementation](./implementation-03-transport.md) |
| Cache burst with 3,000 queries, capture-window CPU | 1,791.524 ms | 137.997 ms | [Cache implementation](./implementation-04-cache.md) |
| Same cache burst, full captures | 3,032 | One | [Cache implementation](./implementation-04-cache.md) |
| Rail pin update with 300 tasks, process CPU | 163.688 ms | 19.054 ms | [Navigation implementation](./implementation-05-navigation.md) |
| Rail pin update with 300 tasks, preference parses | 601 | One | [Navigation implementation](./implementation-05-navigation.md) |
| Unchanged contribution refresh, 20 plugins, registry observer/mount/unmount counts per pass | 40 / 20 / 20 | Zero / zero / zero | [Client plugin implementation](./implementation-06-client-plugins.md) |
| Same refresh, median process CPU across 10 passes | 3,280.5 µs | 382 µs | [Client plugin implementation](./implementation-06-client-plugins.md) |
| Frame open/dispose, 40 cycles, retired-frame event pushes | 120 | Zero | [Client plugin implementation](./implementation-06-client-plugins.md) |
| Removed SDK handlers, 10,000 synthetic captured payloads after GC | 10,000 / 45,091,104 B heap growth | One current fixture payload / 805,864 B; zero payloads after root disposal | [Client plugin implementation](./implementation-06-client-plugins.md) |
| Terminal ring, eight-byte callbacks, retained heap | 3,730,424 B | 82,192 B | [Terminal implementation](./implementation-07-terminals.md) |
| Same ring, saturated overflow process CPU | 106.087 ms | 2.233 ms | [Terminal implementation](./implementation-07-terminals.md) |
| Eight overlapping run-target Starts, spawned / survivors after Stop | Eight / seven | One / zero | [Terminal implementation](./implementation-07-terminals.md) |
| Cleared agent submit, retained timers / late CR writes | One / one | Zero / zero | [Terminal implementation](./implementation-07-terminals.md) |

Startup figures measure public-operation slices, not first paint. RPC heap comes from endpoints in
one isolate with collection outside timed operations. Transport figures measure synthetic owner
workloads; authenticated viewer tests separately prove sibling survival and canonical terminal
restore. Cache figures include the fixed capture window. Rail figures use the actual component in
jsdom, a verified single Solid runtime, and identical probe/config bytes; individual CPU samples
remain noisy. These percentages cannot be added into an overall application speedup.

## Diff and highlighting checkpoint

[Unit 08](./implementation-08-diff-highlight.md) joins eight concurrent cold builds into one syntax
worker and one word worker, with zero survivors after reset. A shifted 200-row window retains all
199 overlapping DOM owners instead of replacing them. Eight identical HTML requests render once,
and eight replaced Markdown fences dispatch only the surviving fence. Keyboard next, page, and
search on 5,000 items each inspect 5,000 disabled flags instead of about 25 million.

These are actual owner counts, simulated worker counts, and jsdom measurements. They do not establish
native latency or browser worker memory gains. Large changing live fences still cost about one second
of highlighting across four 80,011-character updates. A blocked worker returns exact plain source or
omits word marks after its 10-second deadline, without synchronous renderer replay. Stable composers
also acknowledge their exact submitted body and originating callback, preserving successor drafts and
edits made while submission is held. All 60 final source, probe, document, and evidence hashes match
[the coordinator check](./evidence/unit08-coordinator-hash-check.json).

## Costs and behavior changes

RPC ownership adds CPU to tiny operations: 21,000 routes consume 1,516.237 ms versus 1,184.228 ms, or
15.81 microseconds extra per route in the paired fixture. Body and span workloads also consume more
CPU. The accepted benefit is bounded retained authority/memory and correct cancellation/retirement.
The body fixture has a fixed 1.121 MB heap increase with no growing listener/reader retention.
[The RPC tradeoff table](./implementation-02-node-plugins.md) retains every comparison.

HTTP fragmented-body assembly removes one structural full-body copy but shows no measured CPU or
elapsed gain. Its retained-byte sample is unchanged. Keep that result separate from the base64
conversion gain. [Transport measurements](./implementation-03-transport.md) record both workloads.

Cache persistence waits up to five seconds for its first dirty capture, replacing immediate first
capture. Abrupt process loss can omit that unsaved cache interval. Offline restoration, query/schema
policy, and explicit flush remain protected. [Cache ownership and limits](./implementation-04-cache.md)
describe retirement and original-adapter retry behavior.

Notes edits gain ordered acknowledgement and failed-draft recovery. Memory custody is immediate;
device recovery batches at 250 ms and flushes on navigation, retirement, acknowledgement, and error.
Abrupt process loss can omit that interval, and unavailable storage cannot guarantee restart recovery.
Same-Node hidden terminals keep their parsed scrollback because a 256 KiB restore snapshot cannot
represent every supported terminal state. [Navigation ownership](./implementation-05-navigation.md)
records these policies and the Node-switch checks.

Modern plugin modules share one worker per bundle while every view owns a separate bridge. Legacy
SDKs share only equivalent immutable authority contexts and terminate after their last lease. Distinct
legacy contexts can require more workers, up to the documented 512-slot per-bundle admission bound.
This preserves compatibility and retired-grant safety; it is not a legacy memory improvement.
Callback heap uses synthetic payloads and forced collection, not full-application memory.
[Client plugin ownership and limits](./implementation-06-client-plugins.md) records those costs,
the 16-worker modern idle pool, native startup/draining evidence, and presentation-event limitations.

Terminal blocks remove saturated tiny-chunk overhead. Initial eight-byte fill costs increase from
4.183 to 7.209 ms wall and 11.963 to 18.893 ms CPU. Five ordinary 4 KiB samples have median fill
wall of 0.350833 versus 0.381375 ms, and CPU of 0.585 versus 0.809 ms. The unchanged xterm parser's
single cold replay sample is also slower. These measurements do not establish faster terminal
attachment. Process ArrayBuffers observations include storage outside the ring's physical 256 KiB
bound. Durable tmux sessions survive ordinary attachment retirement; uncertain metadata admission
preserves work instead of assuming an unsuccessful commit. [Terminal costs and custody](./implementation-07-terminals.md)
record these limits and the actual process gates.

## Cumulative verification

The units01–05 staged desktop checkpoint passes 124 JavaScript tests and 40 Rust tests. Its Node
service is 2,811,689 bytes, below the unchanged 2,910,000-byte budget. An isolated real Tauri replay
opens Notes and a plain Shell, navigates Home and returns, and preserves the synthetic content and
painted prompt in inspected screenshots. The renderer is unfocused/document-hidden, so this proves
functionality rather than visible UI latency. All recorded fixture processes are stopped.
[Native validation notes](./native-validation-notes.md) preserve activation results and artifacts.

The units01–06 desktop checkpoint also passes 124 JavaScript and 40 Rust tests, with the same
2,811,689-byte Node service. An independent actual SDK/host/native-worker replay creates and retires
seven views using one modern worker: seven view endpoints close, two module endpoints stay warm,
the retired request aborts, and the surviving view reads its own Node and document. The fresh real
Tauri API pane paints its list/detail and synthetic unsent URL. A confirmed native/document focus
attempt restores both regions and the unsaved draft after navigation. Other attempts remain hidden
and blank; the repeated-cycle focus prerequisite fails. These observations do not establish a
visible latency improvement or a sustained native navigation pass. The exact five recorded fixture
processes are absent after stop. [Accumulated verification](./verification.md) owns the root evidence.

The units01–07 repository lint passes 34/34 package tasks. The coordinator independently verifies
53 source/test/probe/report/evidence hashes, replays engine cleanup counts, and passes 47 focused
tests across five files, including actual disposable PTYs, a private tmux server, and a migrated
temporary SQLite database. Terminal native interaction and sustained mixed-use gates remain open.

Final repository lint/test, subsequent units, two-Node integration, and repeated-use plateaus follow
[the implementation sequence](./implementation-plan.md) and
[the sustained validation plan](./sustained-validation-plan.md). Historical Sentry data without
release identity and bounded synthetic probes do not prove several days of active use.
