# Git reads, filesystem services, and worktrees

Investigated October 1, 2026, against `f8e4b59c`. Application source remains unchanged.
Six handoffs are supported by production-owner probes. The first fixes a stale Node event race.
The largest measured work reduction is repeated PR comparison resolution. Large Changes lists
also create thousands of outstanding filesystem requests after the Git cache has answered.

## Ownership and data flow

The Node owns Git, worktrees, filesystem confinement, and task lifecycle. The renderer owns the
poll clock, displayed status, Changes model, and diff hydration. The desktop helper owns token
custody and forwards product requests over pinned HTTPS. None of this work belongs in Rust or in a
renderer filesystem watcher.

The inspected paths are:

| Path | Responsibility |
| --- | --- |
| `packages/client-core/src/features/tasks/taskStatus.ts` | Ten-second poll, summary identity, revision notification, and latest-result publication. |
| `packages/client-core/src/host/registries/shell/schedules.ts` | Starts client schedules, skips hidden documents, and disposes timers and listeners. |
| `packages/client-core/src/features/tasks/taskBridge.ts` and `packages/protocol/src/api.ts` | `/v1/core/task-statuses` transport and wire contracts. |
| `packages/node-core/src/server/routes/projects/worktree.ts` | Authenticated status roster and create/archive/restore routes. |
| `packages/node-core/src/server/worktrees/taskWorktree.ts` | Task-to-root capability, four-worker status sweep, HEAD observer, and per-task creation admission. |
| `packages/node-core/src/server/worktrees/worktreeStatus.ts` | In-flight and two-second status/argument reads. |
| `packages/node-core/src/server/worktrees/worktrees.ts` and `archiveGate.ts` | Worktree add, branch validation, configured copies, fresh dirty refusal, removal, and archive claim. |
| `packages/node-core/src/server/core/git.ts`, `proc.ts`, and `fs.ts` | Git environment/output/deadline policy, process groups, and lexical plus symlink confinement. |
| `packages/node-core/src/server/storage/archive.ts` | Teardown, plugin cleanup, removal, archive persistence, and restore rollback. |
| `plugins/changes/src/client/changesModel.tsx` and `model.ts` | Shown-pane refresh, per-file keys, patch selection, and conditional hydration. |
| `plugins/changes/src/server/localGit.ts`, `localDiff.ts`, and `routes/localGit.ts` | Authorized task-root resolution, porcelain/numstat projection, disk stamps, patch bodies, and Git actions. |
| `plugins/editor/src/server/editor.ts` | File/tree services, save invalidation, and line-marker capability consumption. |
| `plugins/github/src/server/editorLineMarkers.ts`, `mirrorQueries.ts`, and `node/index.ts` | Contributed PR provenance translated into the working document. |
| `plugins/github/src/server/routes/pulls/pullConflicts.ts`, `repos/import.ts`, and mirror routes | Trial merges, explicit repository import, and provider-backed PR diff sources. |
| `packages/node-core/src/server/notify.ts`, `transport/wsHub.ts`, and `projects.ts` | Node events, local plugin listeners, and project deletion. |

The main flows are:

1. A visible client schedule calls `taskBridge().task.statuses()`. The platform WebSocket and custody
   broker forward the read to the authenticated Node route. `computeTaskStatuses` selects active
   tasks with persisted worktree paths, excludes archiving tasks, and applies task authorization
   before filesystem and Git work. Four workers check directory existence and call shared status.
   The response returns through the broker. The client preserves summary identity when unchanged,
   but advances the revision so a shown Changes pane refreshes its richer file projection.
2. Changes resolves the authorized task root through `CoreServices.tasks.root`. The Node rereads
   task/project identity, checks archive state, and validates or adopts the linked worktree branch.
   `localStatus` parses shared porcelain, reads shared numstat and Git-directory text, reads fresh
   operation markers and file stamps, and returns `LocalStatus`. The model builds `patchKey` values
   and fetches only changed patches through the same root capability. Patches and file text remain
   feature data, separate from the shared status text cache.
3. Git/editor/terminal mutations invalidate the worktree read cache and announce
   `worktree:status-changed`. Completed agent turns also refresh task status. The Node status sweep
   observes HEAD and emits `head:changed` to WebSocket clients and Node plugin listeners. The
   Changes model listens for its task and requests updated status. This Node observation occurs
   before the client's `latestOnly` publication check.
4. The editor requests line markers through its contributed provider registry. GitHub reads the
   user-scoped mirror comparison and authorized root, resolves PR head/base objects, computes a
   merge base, and performs two path-specific diffs. One diff identifies PR lines and the other
   translates them through local commits and edits. The Node returns ranges to the editor. GitHub
   PR bodies otherwise come from provider mirrors and immutable blob storage; their renderer
   hydration is area 10, and provider scheduling is area 14.

No client, plugin, or cache can choose an arbitrary absolute worktree path. Nodes own independent
data and execution environments. The terminal client uses the same API and custody boundaries.

## Shipped work and operating conditions

The report reads the docs index, architecture, conventions, workspaces/tasks, caching, plugin map,
diff rendering, and relevant GitHub contracts. Future designs checked include remote access,
compiled-tier migration, and task sandbox/direct-mount isolation. These are proposals where their
acceptance remains open.

History and source confirm these optimizations, which are not proposals in this report:

- `a4b13e63` shares the numstat pair and Git-directory lookup and invalidates running reads.
- `53b6fb96` adds object/stat content keys and conditional patch hydration.
- `9c55bb9b` serializes archive with root access and creation.
- The status owner joins concurrent calls, serves results for two seconds, and bypasses both when
  a refusal needs fresh truth. `computeTaskStatuses` already limits a request to four workers and
  filters permissions before running Git.
- Client schedules skip hidden documents. Retained Changes models defer refresh while their pane
  is not shown and pay one owed refresh when it returns. Status events are the narrower
  worktree/agent events rather than terminal output edges.

On a cold Changes read, one worktree runs status, two numstats, and Git-directory lookup. A warm
read within two seconds starts none of these four processes. Every warm read still parses the
text, checks operation files, and stamps each eligible unstaged entry. Staged entries use HEAD/index
objects, deleted entries use a steady gone stamp, inaccessible entries fall back to refresh, and
submodules deliberately lack a key. External edits are discovered by a later client poll. Disk
stamps are fresh even inside the shared Git window, so caching their result for two seconds would
weaken the shipped same-file edit behavior.

When no client polls, there is no periodic Node HEAD clock beyond startup reconciliation. A
disconnected client cannot complete new reads; Node reads already admitted are not cancelled by
`worktreeGitText`, which has no observer signal. The Git process seam supports cancellation,
deadlines, process-group TERM/KILL escalation, an environment allowlist, and noninteractive Git
authentication. A shared-reader cancellation change must keep another reader's work alive. Area
05 owns transport request disposal, and area 02 owns forwarded loaded-worker Request signals.

Two complete overlapping sweeps over 16 synthetic slow worktrees started 16 status processes with
peak concurrency four. Two disjoint authorized sweeps started 16 processes with peak eight.
The four-worker bound is per request, and same-roster joining works. Treat a Node-wide read budget
as conditional work for demonstrated heterogeneous/multiple-client load. Do not claim the shipped
bound is absent or serialize all Git operations behind one lock.

## Measurements

The retained [probe](./11-git-probe.mjs) dynamically imports the production owners. It wraps builtin
spawn/lstat only to count operations and inject explicit synthetic output in the retention,
sweep, and HEAD-race cases. Changes, PR markers, pathname, and output-limit cases use real Git on
disposable repositories. Git global/system configuration is disabled. Fixtures are removed after
each run. No normal profile, provider connection, private repository, or paid model is read.

The desktop fixture has six non-Git tasks. These measurements add no live-session tasks and make
no visible-renderer latency claim. Synthetic Node measurements run under `node --import tsx` on
macOS with the version recorded in each artifact. Node CPU excludes child Git CPU, and sampled
heap from outstanding `lstat` work is distinct from retained heap after explicit garbage collection.
Serialization of the returned status is included in the status probe's Node time and response byte
count. The figures describe one sample of the stated workload, not a full day of application use.

| Case | Before evidence |
| --- | --- |
| [HEAD overlap](./11-heads-before.json) | Two status processes emit B, A, B after A was seeded and a delayed old A completes after fresh B. |
| [3,000 untracked files](./11-stamps-before.json) | Cold reader: 4 Git processes, 3,003 lstat calls, peak 3,000 outstanding lstat, 61.4 ms wall, 61.0 ms Node CPU. |
| Same warm reader | 0 Git, 3,003 lstat, peak 3,001, 13.7 ms wall, 48.7 ms Node CPU, about 12.5 MB sampled heap growth. |
| Four warm readers | 0 Git, 12,012 lstat, peak 12,004, 81.5 ms wall, 282.1 ms Node CPU, about 33.4 MB sampled heap growth. Each response is 487,447 bytes. |
| [Eight PR marker reads](./11-markers-before.json) | 48 real Git commands, peak 16 children, 92.5 ms wall. Common work repeats 8 checks, 16 rev-parses, and 8 merge-bases. Per-file work is 16 diffs. An immediate one-file repeat starts 6 more commands. |
| [Expired cached text](./11-retention-before.json) | 24 paths, each with 672,000 bytes of synthetic numstat. About 15.7 MB remains above the warmed heap baseline after TTL and GC. After all directories disappear, a missing-path sweep leaves the text retained. Explicit invalidation reclaims about 16.1 MB. |
| [Quoted paths](./11-paths-before-v2.json) | Three of five real filenames return encoded names, absent keys, changing effective poll keys, and empty patches after two Git commands each. Plain and space-containing names return valid 33-byte patches and stable keys. |
| [Output cap](./11-limits-before.json) | A 17,825,807-byte untracked text file produces a successful 16,777,077-byte partial patch without its final line. Raw Git reports `truncated: true`. The equivalent tracked diff reports the explicit 16 MiB cap error. |
| [Overlapping sweeps](./11-scans-before.json) | Full/full requests retain peak 4 and 16 total commands. Disjoint authorized requests reach peak 8, with 16 total commands. |

The historical Sentry leads are `task-statuses`, 3,132 samples, median 346.6 ms and p95 1,797 ms,
and local changes, 24 samples, median 305.8 ms and p95 3,120.6 ms. They lack release IDs and may
include suspension. They are not the baseline for this checkout and do not establish the cause of
those tails.

## Findings and implementation gates

### [PERF11-01] Fence HEAD observations before publishing Node events

- **Evidence**: `packages/node-core/src/server/worktrees/taskWorktree.ts:130` awaits a status and
  then calls `noticeHead` without an observation generation. `taskWorktree.ts:150` stores only the
  last SHA. `worktreeStatus.ts:122` deliberately permits callers admitted before invalidation to
  receive their old run. `plugins/changes/src/client/changesModel.tsx:83` refreshes on these Node
  events. The HEAD probe reproduces the stale event sequence.
- **Impact**: One actual HEAD transition emits three events, including a regression to an obsolete
  SHA. Clients can refresh repeatedly, and Node plugins can react to the wrong revision. Client
  latest-result publication cannot repair events already emitted by the Node.
- **Effort**: S, including a delayed overlapping-read characterization test.
- **Risk**: MED. A global scan generation would incorrectly suppress observations for disjoint
  authorized rosters. Silent initial seeding and supported HEAD changes must remain intact.
- **Confidence**: HIGH for the reproduced ordering defect. Production frequency is unmeasured.
- **Fix sketch**: Give each task an observation generation before its status await and publish
  HEAD only from its newest admitted observation. Keep the generation at the per-task observer,
  distinct from the client's response ordering and Git cache TTL.

The fail-before case seeds A, admits delayed A, invalidates, completes B, then completes old A.
Require one B event, no A regression, and no duplicate B on a warm follow-up. Cover failed/null
status, initial seed, multiple tasks, archive, and permission-filtered concurrent requests. An
older response may still resolve to its original caller under the cache contract. It cannot
mutate the newer Node observation.

### [PERF11-02] Bound per-read filesystem stamp admission

- **Evidence**: `plugins/changes/src/server/localDiff.ts:155` uses `Promise.all` over every eligible
  change. `localDiff.ts:170` launches its fresh lstat. Git reads are already shared at
  `localDiff.ts:143` and `localDiff.ts:151`; that sharing does not bound the later filesystem work.
- **Impact**: A 3,000-file untracked tree produces about 3,000 outstanding stamp promises per
  reader. Four warm readers issue 12,012 stats with about 33.4 MB sampled transient heap growth
  despite starting zero Git processes. The Node's filesystem pool and event loop must drain this
  burst alongside unrelated file/process work.
- **Effort**: S for bounded workers. M if adding ownership-safe in-flight projection joining.
- **Risk**: LOW for bounded workers that preserve order and read every stamp. MED for sharing an
  entire projection because it must respect invalidation and per-read disk freshness.
- **Confidence**: HIGH for operation counts and outstanding-request growth. No claim of a
  persistent 33.4 MB leak or a particular visible latency improvement.
- **Fix sketch**: Replace the all-at-once stamp mapping with a small bounded worker loop at
  `localStatus`. Choose the bound with the same 3,000-file workload. Keep each admitted reader's
  fresh stamps; evaluate overlapping-projection joining only if the existing worktree read owner
  can supply a mutation generation without creating a second freshness authority.

Require the same file set, order, counts, and keys. A same-size edit, restored mtime, chmod, rename,
stage, unstage, commit, conflict, submodule, deletion, and lstat failure retain their semantics.
The first acceptance gate is bounded outstanding stats, roughly worker count plus the independent
operation checks. Per-reader operation count remains 3,003 with bounded workers alone. Any claim
of reducing four readers to one projection requires explicit fresh-read and invalidation tests,
and must resolve authorization before joining by root. Do not replace fresh stamps with cached
porcelain equality or counts.

### [PERF11-03] Join PR comparison work across overlapping marker reads

- **Evidence**: `plugins/github/src/server/editorLineMarkers.ts:40` loads common root/mirror facts
  for every path. `editorLineMarkers.ts:45` resolves the same head and base per path.
  `editorLineMarkers.ts:50` recomputes the same merge base. The path-specific diffs start at
  `editorLineMarkers.ts:52`. `plugins/editor/src/client/EditorPane.tsx:313` requests markers on
  document initialization and `EditorPane.tsx:391` refreshes a reused document after two seconds.
- **Impact**: Eight overlapping document reads on one PR run 32 duplicate common-comparison
  commands plus 16 required path diffs. Peak children are 16. A one-document read costs six
  commands even when repeated immediately. The eight-document case is a synthetic multiple-file
  or multiple-client stress case; the default foreground editor typically shows one document.
- **Effort**: M, including mirror/base-ref changes and unload/cancellation coverage.
- **Risk**: MED. Stale base refs or local HEAD translation can paint false provenance. The GitHub
  owner must remain behind its contributed marker provider and scoped core capabilities.
- **Confidence**: HIGH for repeated work. The aggregate frequency in the live editor is unmeasured.
- **Fix sketch**: Join only overlapping common comparison resolution inside the GitHub provider,
  keyed by authorized root, scoped mirror owner, base ref, and PR head SHA. Resolve mutable refs
  freshly for each comparison wave. A bounded immutable merge-base memo can be keyed by resolved
  object SHAs. Continue reading the local path-specific translation diff freshly.

For eight overlapping readers, common work should run once: a theoretical target is 20 commands
instead of 48 when the remote base ref resolves on the first attempt. This is an operation-count
target, not a measured after result. Do not extend `worktreeGitText` to persistent ref-dependent
queries: its invalidation contract covers worktree writes, not every external/common-ref change.
Test external base-ref movement, new mirrored head SHA, local commits, uncommitted edits, differing
paths, different roots/Nodes/users, missing objects, provider unload, and one reader cancelling while
another remains. Retain PR-head provenance rather than treating unpushed commits as PR changes.

### [PERF11-04] Retire expired Git text at its cache owner

- **Evidence**: `packages/node-core/src/server/worktrees/worktreeStatus.ts:34` stores text by path
  and argument list. `worktreeStatus.ts:57` checks age only when answering. Completion at
  `worktreeStatus.ts:63` installs text without expiry removal. `taskWorktree.ts:126` skips missing
  directories without invalidating their remembered text. `packages/node-core/src/server/projects.ts:248`
  deletes task rows while intentionally leaving folders on disk.
- **Impact**: Unrequested successful text outlives its two-second usability window until replacement,
  path invalidation, or process exit. The controlled 24-path fixture retains about 16 MB past TTL
  and after an external-removal sweep. Repeated polls of a fixed path/argument set replace entries,
  so this is not linear growth per poll. Normal successful worktree removal invalidates that path.
- **Effort**: S to M for one bounded expiry mechanism and ownership tests.
- **Risk**: LOW to MED. An expiry callback for an older run must not delete a replacement or a
  running read. Aggressive body eviction must not destroy useful in-flight joining.
- **Confidence**: HIGH for retention. The 24 large outputs are synthetic cardinality, not evidence
  that an ordinary all-day profile retains this amount.
- **Fix sketch**: Remove failed placeholders and expire completed text through one Node-owned
  bounded sweep or equivalent generation-checked expiry. Delete empty path maps. Preserve running
  entries until settlement and preserve invalidation's treatment of already admitted callers.

Rerun the retention case with GC after TTL and no readers, then after external directory removal.
Most of the 16,128,000 output bytes should be reclaimable without an explicit global invalidation.
Continue to join warm calls and preserve zero-process warm reads before expiry. Prefer one expiry
owner over an unbounded timer per read. Do not increase the cache window.

`taskWorktree.ts:150` also retains one HEAD SHA per observed task with no retirement call. That is
source-confirmed growth by distinct historical task IDs, not by polling frequency, and its body is
small compared with stdout. If the observation structure changes for PERF11-01, add task-lifecycle
retirement or pruning against the authoritative complete roster. A confined caller's filtered
roster must never prune another task's observation. Its heap magnitude was not measured separately.

### [PERF11-05] Decode Git path records before deriving patch keys

- **Evidence**: `plugins/changes/src/server/localDiff.ts:36` deliberately accepts C-quoted names
  as-is. Paths are extracted at `localDiff.ts:56`, `localDiff.ts:70`, and `localDiff.ts:76`.
  `localDiff.ts:170` stats those encoded strings and falls back to no key.
  `plugins/changes/src/client/model.ts:371` makes the effective key poll-dependent when absent.
- **Impact**: Accented, tab-containing, and quote-containing filenames in the probe return names
  that do not exist on disk. Their effective keys move every poll and each requested patch starts
  two Git commands but returns an empty patch. The shipped conditional hydration cannot stabilize
  them, and stage/discard actions also receive the wrong path.
- **Effort**: M, including ordinary, rename, conflict, numstat, Unicode, and separator cases.
- **Risk**: MED. A shared NUL-record format change also touches the core dirty/count parser and
  rename record handling. Incorrect decoding can change path identity or confinement behavior.
- **Confidence**: HIGH. The real-Git fail-before artifact carries five exact synthetic names.
- **Fix sketch**: Parse exact Git path records at the Node boundary. Either implement complete
  C-quoted byte decoding for porcelain and numstat, including both rename names, or migrate both
  status consumers and numstat parsing to Git's NUL-delimited forms. Keep wire paths decoded and
  revalidate them before file access and mutations.

Require exact pathname identity, nonempty patches, and unchanged effective keys on an idle second
poll for all five probe names. Add newline, backslash, rename, staged/unstaged, conflict, binary,
and non-ASCII byte cases supported by the product's string path model. `core.quotepath=false`
alone does not handle tabs, quotes, or newlines. Preserve the rail's one-entry count for a rename
and the shared status/numstat process counts. These are correctness gates before claiming fewer
patch reads for encoded paths.

### [PERF11-06] Reject incomplete untracked diff bodies

- **Evidence**: `packages/node-core/src/server/core/git.ts:18` caps each Git stream at 16 MiB.
  `packages/node-core/src/server/core/proc.ts:270` makes truncation an error for throwing callers.
  `plugins/changes/src/server/localDiff.ts:197` uses the raw result to accept no-index diff exit
  codes zero and one, but omits `truncated`. The following line returns the partial body as success.
- **Impact**: The 17 MiB synthetic untracked file is represented by a successful partial 16 MiB
  patch. Its final line is absent. The equivalent tracked patch fails explicitly. This makes a
  large-body performance limit silently change the content the person reviews.
- **Effort**: S, with an output-limit characterization test.
- **Risk**: LOW. Git diff's ordinary exit one must remain accepted. An oversized body should use
  the feature's error row/retry path rather than masquerade as a complete patch.
- **Confidence**: HIGH. Real Git reports truncation in the artifact.
- **Fix sketch**: Validate spawn, timeout, abort, and output completeness before accepting no-index
  diff's allowed exit codes. Preserve the cap and return the same explicit oversized-content
  failure as tracked diffs. Audit raw Git result consumers such as marker `gitText` for the same
  completeness rule before sharing or memoizing their results.

The fail-before assertion is that the untracked call reports the cap error, as the tracked call
does. Below-cap UTF-8 content remains exact, including final newlines. Do not raise the cap to hide
this failure. This handoff is a content-correctness prerequisite, not a measured CPU improvement.

## Lifecycle and filesystem review

Task-root reads use task/project identity and refuse archived/archiving tasks. Persisted linked
worktrees reread `.git` and admin HEAD, adopt a live branch change, and refuse a detached or removed
link. These synchronous small reads avoid process creation and preserve execution correctness.
Caching root, branch, or realpath results across operations would weaken external-edit and symlink
revalidation. No such cache is proposed.

`resolveTaskCwd` joins per-task creation and deletes its entry in `finally`. Fresh creation runs
configured copies and the bounded `core:worktree-created` hook once. Local branches start at the
mapped checkout's HEAD. PR worktrees fetch into a private per-PR ref, preserving the shipped
protection against `FETCH_HEAD` races. No duplicate-creation performance finding is supported.

Configured copies use synchronous mkdir/copy operations. A huge configured copy could block the
Node, but no representative configured-copy workload was available, and setup is not a periodic
poll path. Keep it as a possible lifecycle follow-up rather than inventing a caching fix. Setup and
teardown terminal/process behavior belongs to the terminal/process owners already investigated.

Archive claims the task, waits for admitted creation, suppresses root reads, captures review input,
runs teardown, stops sessions, runs selected plugin cleanup, removes the worktree, drops saved
sessions, and persists archive. The removal guard reads fresh and Git itself refuses unsafe
non-forced removal. The claim is released on success or refusal. Restore validates the branch,
rebuilds the worktree, and rolls back to archive on failure. Concurrent restore/archive and archive
teardown policy changes should have explicit lifecycle tests; no optimization is selected here.

`resolveInRoot` performs lexical checks and resolves the real root plus the nearest existing
ancestor to confine new writes. `confineExistingFile` rechecks the real leaf and file type.
Filesystem authority remains at the Node. File-tree rendering, open-document pools, search, and
file-body caching are area 12. In particular, unstaged `localNewSideText` and editor `read` use
whole-file `readFile`; they lack the Git stream cap. That is a shared large-body policy handoff to
area 12, not a suggestion to truncate editor text.

## Replay and validation

Run each retained probe with a distinct tag. Omitting the tag writes `sample` artifacts. Preserve
the before files and invoke the production owner after implementation:

```bash
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs heads sample
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs stamps sample
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs markers sample
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs retention sample
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs paths sample
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs limits sample
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs scans sample
```

If an owner moves, update the probe's production import/entry call. Replaying a retired helper does
not establish a fix. Keep synthetic adapters restricted to mirror facts, task rows, and explicit
Git-output controls. Do not replace the candidate algorithm with a benchmark implementation.

Focused existing suites passed with one worker: `worktreeStatus.test.ts`, 11 tests, and
`localDiff.test.ts`, 43 tests. They cover warm joining, invalidation, fresh removal, running-read
separation, and content-key mutations. Their successful results do not cover the new HEAD-order,
quoted-path, or truncated-untracked failures. The coordinator's recorded baseline `pnpm lint` and
bounded `pnpm test` passed before this source-read-only investigation.

Implementation requires `pnpm lint`, relevant focused characterization tests, and bounded
`pnpm test`. Changes to decoded wire paths or status behavior require the real Tauri Changes flow
with disposable Git tasks, exact filenames, stage/unstage/discard, external edits, task switching,
and archive refusal. Coordinate window visibility before any timing claim. Do not inspect private
GitHub mirrors or run paid provider work.

## Handoffs, rejected changes, and gaps

Area 12 receives the Node-marker operation evidence and must preserve document/save/line-range
semantics when changing marker refresh. It owns renderer file trees, search, document pools, and
whole-body policy. Area 14 owns provider mirror and integration schedules. Area 16 can replay the
post-GC cache retention under a longer disposable workload. Area 05 transport cancellation and
area 02 worker signal ownership remain prerequisites for cancelling shared backend readers.

Reject a new periodic Node Git clock, recursive watchers, longer TTLs, cached refusal answers,
cached disk stamps, cached confinement, global Git serialization, and dropping large/ignored
entries to make the list cheaper. These either duplicate shipped work, lack evidence, or change
correctness. Source parsing makes several linear passes and allocates maps per local read, but
the measured filesystem burst and repeated PR spawns have clearer ownership and larger work
counts. A parser rewrite alone is not selected beyond the exact-path correctness change.

No remote Node, real multi-window renderer, visible editor latency, all-day profile, slow network
filesystem, large configured-copy setup, Git credential helper, or live paid provider operation was
measured. Headless HEAD observation remains the documented product choice. The report measures
bounded synthetic workloads and states the ownership gates needed to implement each handoff.
