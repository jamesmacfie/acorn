# 2026-09-03 — phase 10, the re-measurement

[Back to performance](../performance.md)

## 2026-09-03 — phase 10, the re-measurement

Same machine, Node 24.11.0 (Node 26.8.1 for the terminal client). Every phase from 0 (`17b03dbe`) to
9 (`c11bcd29`) had shipped, and nothing else was in the tree.

Read this section for the programme's before-and-after and for the four things nobody had measured
before it. Where a number here disagrees with an earlier phase's, both are kept and the disagreement
is named, because a phase that decided on the old figure decided on the old figure.

### The build artifacts, re-measured

`pnpm --filter @acorn/desktop build` and `pnpm --filter @acorn/tui build`, on the tree at `c11bcd29`.

| | Before the programme | The phase that took it | Now |
| --- | --- | --- | --- |
| Desktop startup scripts | 1,329,679 B | 627,146 B (phase 2) | **631,512 B** |
| Desktop startup assets | 148 | 43 (phase 2) | **44** |
| Desktop preload depth | 4 | 3 (phase 2) | **3** |
| Desktop styles | 92,153 B | 91,569 B (phase 2) | 91,599 B |
| Terminal client's eager closure | 1,114,282 B in 110 chunks | 841,142 B in 91 (phase 4) | **857,233 B in 95** |
| Terminal client's whole build | 2,100,437 B | 2,122,669 B (phase 4) | 2,148,414 B |
| The node's one service chunk | 1,093,602 B | 1,099,402 B (phase 3) | 1,110,974 B |

**Everything is inside its ceiling and everything has drifted the wrong way since the phase that took
it.** The desktop is 4,366 B and one request over phase 2's figure, the terminal client 16,091 B and
four chunks over phase 4's with 12,767 B of headroom left under the 870,000 B ceiling that stood on
the day, and the service chunk 11,572 B over phase 3's. None of it is a regression anyone would
notice and all of it is the same drift the denylist exists for: five phases of ordinary work each
added a few kilobytes to the first paint. The check that catches a 300 KB mistake does not catch
this, and it is not meant to.

The desktop's uncounted tail grew too: 120 chunks and 1,595,686 B are one dynamic import away, against
109 chunks and 1,509,975 B after phase 1. That number is reported and not gated, for the reason phase 0
gave.

### The node's boot, end to end, with a fresh data root

`npx vitest run test/boot.test.ts` from `apps/desktop`, which spawns the real helper under the pinned
runtime with `ACORN_PERF=1` and hands it the staged `service.js`. One launch, a fresh root, eleven
bundled plugins and no loaded ones.

| `[helper:boot]` | Offset | | `[service:boot]` | Its own clock |
| --- | --- | --- | --- | --- |
| `handshake` | +33 ms | | `login-shell` | 0 ms |
| `plugin-cache sweep` | +34 ms | | `bundled-packages` | 11 ms |
| `bundled plugins trusted` | +34 ms | | `migrate` | 91 ms |
| `ws bound` | +41 ms | | `graph` | 1 ms |
| **`ready line`** | **+44 ms** | | the whole `init` pass | 24 ms |
| `service.start` | +689 ms | | `cert` | 1 ms |
| `node adopted` | +701 ms | | `bind` | 19 ms |
| | | | **`listener-up`** | **154 ms** |

**The window opens 645 ms before the node is listening**, and phase 2's ordering holds: `ws bound`
before `ready line` before `service.start` before `node adopted`. Phase 2 measured the same gap at 601
to 747 ms against the real 16-plugin root, so the gap has not moved. What moved is what fills it.

Two figures worth putting beside their originals:

- **`migrate` is 91 ms on a first-ever boot**, where phase 0 measured 220 ms on an empty root under
  `tsx` and phase 3 measured 29 ms warm on the real root. The first-boot cost is the migration chains
  themselves and nothing else now that phase 3 took `diskBlobCache`'s `chmod` sweep out of the step.
- **The `init` pass is 24 ms**, `agents` being all of it, which is exactly what phase 3 measured warm.
  The 46 ms phase 0 recorded was the realistic root with five loaded plugins in it.

The same launch with `isPackaged: true`, which is the flag that turns the login-shell `PATH` probe on:

| | Value |
| --- | --- |
| `login-shell` | **2 ms** |
| `migrate` | 76 ms |
| `graph` | 2 ms |
| `bind` | 15 ms |
| **total to `listener-up`** | **121 ms** |

**Phase 3's headline holds.** The probe measured 569 ms on this machine before phase 3 moved it behind
the boot, and it is 2 ms on the path now. The 209 ms phase 3 recorded for a packaged boot was against
the realistic sixteen-plugin root; 121 ms here is the same shape against a fresh one.

The gap the node's own account cannot see is **535 ms** here (helper +689 against the node's +154),
where phase 2 measured 449 ms and phase 3 split it into 23 ms of `fork` plus 293 ms of bundle
evaluation plus about 133 ms of the helper's own work. The section below re-measures the middle term at
about 350 ms, which makes 23 + 350 + 160 and lands on the 535 ms measured end to end. Two independent
measurements agreeing is the reason to believe the larger figure.

### The service bundle's evaluation: 351 ms, not 293 ms, and the difference is the machine

`node-aarch64-apple-darwin`, the runtime the desktop ships, importing the chunk in a fresh process
seven times. **Both chunks were measured today**, which is the control that matters: the older one is
the exact artifact phase 3 measured.

| Chunk | Bytes | Median of seven | Range |
| --- | --- | --- | --- |
| `coreTools-B7AABCpy.js`, the one phase 3 measured at **293 ms** | 1,099,402 B | **351.6 ms** | 340.4 to 467.1 ms |
| `coreTools-CxFs0y90.js`, the tree at `c11bcd29` | 1,110,974 B | **353.1 ms** | 347.9 to 361.9 ms |

So the 11,572 B this programme's later phases added costs about 1.5 ms, and the 58 ms between phase 3's
figure and this one is measurement conditions rather than code. Phase 3 timed the child's own marks
across seven forks; this is a dynamic import from a bare process, which carries Node's bootstrap and
the loader's resolution with it. Anyone quoting a number for this should quote 350 ms and say which
runtime it was.

Timing each external import in one process, in the same order phase 3 used, gives the same shape at
about 1.7 times the magnitude: `drizzle-orm` 158.6 ms, `drizzle-orm/sqlite-core` 105.2 ms,
`@agentclientprotocol/sdk` 60.4 ms, `ws` 22.7 ms, `@hono/node-server` 21.6 ms, `jose` 20.5 ms, `hono`
10.0 ms, `smol-toml` 6.1 ms, `node-pty` 4.4 ms, the drizzle migrator 3.2 ms, `@vscode/ripgrep` 1.4 ms,
`zod` 1.2 ms warm, `node:sqlite` 0.2 ms. The bundle's own chunk with all of them warm is 73 to 132 ms,
against phase 3's 51 ms. The uniform factor across twelve unrelated packages says the machine, not the
tree.

**Nothing in this changes phase 3's conclusion.** External libraries are still the large majority,
`drizzle-orm` and its `sqlite-core` are still a third of the whole on their own, and per-plugin chunks
would still evaluate all of acorn's own modules on every boot.

### The request log and the histograms, read for the first time

Five phases wrote "not measured" against phase 0's `ACORN_PERF=1` output, all for the same reason: it
needs a node serving real traffic, and this machine's live instance held port 4317 and the data root's
lock. It does not any more, so here it is.

Not the packaged shell, and not a person driving it. A standalone node under `tsx` with `ACORN_PERF=1`,
against a **fresh scratch data root** with the eleven bundled plugins, and a scratch git repository of
eight files with four git-branch tasks in it, each with a real worktree materialised through
`GET /v2/p/editor/tasks/:id/editor/root` and one dirty file. Driven over pinned HTTPS with the device
token the handshake line prints. Fifteen rounds two seconds apart; each round is two concurrent
clients, and each client asks for the rail's statuses, the task list, and one task's local changes,
which is what a desktop window with a changes pane open does on a status ping.

Ninety-one requests, and `kill -USR2` for the histograms:

| Seam | Count | Mean | p50 | p95 | Max |
| --- | --- | --- | --- | --- | --- |
| `git status` | **60** | 21.8 ms | 20.5 ms | 35.2 ms | 36.1 ms |
| `git diff` | **60** | 18.4 ms | 17.8 ms | 28.0 ms | 29.6 ms |
| every SQLite statement together | **183** | 0.02 ms | 0.0 ms | 0.0 ms | **0.1 ms** |

| Route | Requests | Mean | Max |
| --- | --- | --- | --- |
| `GET /v2/core/task-statuses` | 30 | 19.8 ms | 36.8 ms |
| `GET /v2/p/changes/tasks/:id/local/changes` | 30 | 20.3 ms | 30.8 ms |
| `GET /v2/core/tasks` | 31 | **0.7 ms** | 1.5 ms |

Four things fall out of that, and three of them are phase 5's done-when lines answered through the
instrument phase 5 asked for rather than at the seam:

1. **Sixty `git status` spawns is four per round: one per worktree per two-second window.** Two clients
   asking thirty times produced the same count one client would have. Phase 5's line was "one status
   ping spawns at most one `git status` per worktree per TTL window, however many clients are
   connected", and this is that line, measured.
2. **Sixty `git diff` spawns for one worktree.** The changes pane's `--numstat` pair is not coalesced,
   so it is two processes per client per ping, and two clients on one task cost as much as the rail
   costs for four. Phase 5 named this residue and did not fix it; the number says it is now the larger
   half of the git bill on any client with a changes pane open.
3. **The task list is 0.7 ms.** Phase 5 took it from 26 queries to 3 for 24 tasks, and this is what
   that is worth at the request seam: the route every client refetches on `tasks:changed` costs less
   than a millisecond.
4. **SQLite is not where the node's time goes.** Every statement in the whole run, boot excluded,
   totals 3.4 ms, and the slowest single one is 0.1 ms. The programme refused splitting the node into
   threads and asked for these numbers instead; they say the synchronous database is not the thing to
   split away from.

**Warm-token auth: zero reads, exactly.** A hundred `GET /v2/core/prefs` with one device token, in one
minute:

| | Value |
| --- | --- |
| Reads of the `devices` row | **1** |
| The route's own `prefs` reads | 100 |
| Request duration | mean **0.12 ms**, p50 0.10 ms, p95 0.20 ms, max 0.80 ms |

That is phase 5's `ACORN_PERF` line — "zero SQLite reads in auth on a warm token" — read off the
histogram rather than counted at the seam. The 0.12 ms is also the first honest figure for what the
node's own request overhead is when the route does almost nothing.

### The transcript projection, and why it does not become incremental

Phase 7 left the incremental projection to phase 10 and named the number to argue from: 0.85 ms per
rebuild at full size. Re-measured against the same session out of a read-only copy of this machine's
`agents.sqlite`, session `72f744c0-abff-49b6-a84f-4077989ce7bf`, 2,727 rows and 1,850 after the usage
fold the node now does. Median of 50 runs after a warm-up.

| Rows | Items projected | Median rebuild | Per row |
| --- | --- | --- | --- |
| 500 | 137 | 0.182 ms | 0.36 µs |
| 1,000 | 287 | 0.333 ms | 0.33 µs |
| **1,850, the largest real session** | 522 | **0.61 ms** | 0.33 µs |
| 7,400, that session four times over | 2,088 | 4.73 ms | 0.64 µs |

**It is linear, and it is 0.61 ms rather than phase 7's 0.85 ms.** Both are the same quantity measured
the same way on the same data, so treat 0.85 ms as the top of the range and 0.6 ms as the middle of it.
At about 25 events a second, the largest session in a 66,264-event database costs 15 ms of main thread
per second of streaming, and one rebuild is a twenty-seventh of a frame. A session would have to reach
roughly 25,000 events before a rebuild filled a frame, and the whole database's largest is 2,727.

The event mix in that session is worth recording because it is not the mix § What was decided describes:
`tool` 1,682, `usage` 881, `assistant_message` 137, everything else 27. Folding usage is what takes
2,727 to 1,850; the 1,682 `tool` rows are already collapsed at render time and folding them at the
source would take it to about 700.

### The tree host's remove, which was the one argument the numbers took up

`packages/client-core/src/host/tree/treeState.ts`'s pre-flight simulated a batch against a copy of the
parent map, and for each `remove` it scanned every live node and walked its ancestors. Measured against
a synthetic loaded-plugin tree, before and after making it a walk down a child index:

| Tree | Removes in one batch | Before | After |
| --- | --- | --- | --- |
| 1,000 nodes | 100 | 18.4 ms | **2.3 ms** |
| 1,000 nodes | 500 | 57.2 ms | **6.1 ms** |
| 4,500 nodes | 100 | 62.0 ms | **2.9 ms** |
| 4,500 nodes | 1,000 | 488.4 ms | **19.9 ms** |
| 4,500 nodes, near the 5,000 cap | 4,000, the batch cap | **1,103.9 ms** | **71.4 ms** |

**A batch that emptied a tree at the node cap blocked the main thread for 1.1 seconds.** That is what
the deferred argument was waiting to see, and it is 15 to 24 times cheaper now. The insert side is
unchanged at 24 to 28 ms for 4,508 inserts across four batches.

The same walk had a correctness bug that the rewrite ends. The old loop iterated a snapshot of the
projection while deleting from it, so a grandchild whose parent the same loop had already deleted
walked up into a hole, stopped, and survived in the projection. A later op in the same batch addressing
that grandchild was then accepted, which is exactly the sandbox-and-host disagreement the pass exists
to catch. `treeState.test.ts` holds both halves: the refusal, and a bound on the batch.

The residue, named because it is now the larger half: applying the batch takes 71.4 ms because
`detach` filters the parent's children array once per `remove`, which is quadratic in the siblings.
Fixing that means keeping an index of the live children too, and nothing has measured a real plugin
tree that removes thousands of siblings at once.

### The persisted query cache, weighed after months of use

Phase 0's read said to measure the blob before deciding between per-key persistence and a shorter
throttle. The desktop persists through `idb-keyval` into the webview's IndexedDB, so the blob is a row
in `~/Library/WebKit/acorn-desktop/WebsiteData/Default/*/IndexedDB/*/IndexedDB.sqlite3`. Read from a
copy of this developer's real store.

| | Value |
| --- | --- |
| The row as IndexedDB stores it, UTF-16 | **2,194,679 B** |
| The same blob as JSON | **1,097,335 characters** |
| Queries in it | 81 |
| Mutations in it | 0 |
| The largest single entry | 163,159 B, `["plugin-chrome","rollbar","rollbar-items",…]` |
| The next five | pull-request entries, 38 KB to 65 KB each |
| `JSON.stringify` of the whole thing | **2.4 ms** median |
| `JSON.parse` of it on restore | 2.0 ms |

**A megabyte, and 2.4 ms once per five-second window.** Eighty-one queries holding a megabyte also says
the exclusions in `queryPersistence.ts` are doing their job: no patch bodies and no blobs are in it.

### The suites

| Command | Result |
| --- | --- |
| `PATH=~/.nvm/versions/node/v26.8.1/bin:$PATH npx vitest run` in `apps/tui` | 34 files, **318 tests, 0 skipped**, 203 s |
| `pnpm --filter @acorn/desktop test` | 14 files, 91 tests, plus 30 Rust tests |

### What is still not measured, and what each one needs

- **`first paint` in a packaged build.** Still unread. It is a `requestAnimationFrame` callback and
  macOS pauses those while the window is occluded, so it needs someone at the machine with the window
  frontmost. What this phase did instead is add `[renderer:boot] tree built`, which fires when `render`
  returns and therefore fires in a background window, so a launch watched from a terminal now has a
  mark for the end of the renderer's own work. The paint mark stays for whoever can watch it.
- **A `pnpm dist` bundle launched from Finder.** The packaged-flag boot above is the real helper and
  the real staged bundle under the pinned runtime, but it is still a test harness rather than an
  installed app, and the renderer is not in it at all.
- **A person's session.** No agent has streamed, no build has spewed through a terminal, and no task
  has been switched with every pane open, through the packaged shell with these ten phases in. The
  request log above is a script's traffic against a scratch root: real subprocesses, a real database
  and real routes, but not a real day. `docs/testing.md`'s smoke checklist is what covers that, by
  hand.
- **A multi-node fleet.** Nothing here says what a second and third node's broadcast volume looks
  like, which is the exit condition the interest model on `/v2/events` still waits on.
- **Memory, anywhere.** An xterm per open tab, the editor's document pool, the highlight cache, a third
  fewer event objects per session: four phases traded memory for time and none of them weighed it.
- **The immutable-asset saving.** A dev build serves `no-store` by design, so it needs `pnpm dist` and
  a second launch.


## 2026-09-11 — the node's async-local store

Not a phase of this programme. The telemetry programme's phase 2 added the codebase's first
`AsyncLocalStorage`, and the decision to adopt it was gated on measuring what it costs
([telemetry.md](../telemetry.md) § Ambient attribution). The number belongs here, with the rest.

Machine: this developer's M-series macOS laptop, Node 24.11.0. A throwaway vitest file in
`packages/node-core`, since deleted: a Hono app with the real `requestIdMiddleware` over a route
that awaits six times and runs five prepared statements against an in-memory SQLite database.
20,000 requests per line after 4,000 warm-up, repeated three times.

| Line | p50 | p95 |
| --- | --- | --- |
| The request, telemetry off | 0.0570 ms | 0.0670 ms |
| The request, telemetry on | 0.0638 ms | 0.0721 ms |
| The handler alone, no store | 0.0524 ms | 0.0580 ms |
| The handler alone, inside the store | 0.0527 ms | 0.0579 ms |

**Entering the store costs 0.3 to 0.7 microseconds per request**, which is 0.6% to 1.3% of this
fixture's 53-microsecond handler and 0.5% of the request line with telemetry on. The gate was 5%, so
the store is adopted for every seam rather than for plugin dispatches alone.

Reading it, `AsyncLocalStorage.getStore()`, costs **8.3 nanoseconds** inside a store and 7.8 outside
it, over 20 million calls. That is why `storage/sqlite.ts` asks per statement rather than per
prepare.

Two things this does not measure. The fixture is a 57-microsecond request and a real one is
milliseconds, so 0.3 microseconds is a smaller fraction in the app than it is here. And the 12% the
"telemetry on" line costs over "telemetry off" is the whole of the collector, shipped in phase 0:
the request span, the SQL histograms, and the trace ids. Only the 0.3 microseconds is this phase's.
