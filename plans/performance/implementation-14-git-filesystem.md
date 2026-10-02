# Git filesystem implementation record

Implemented October 2, 2026. Unit 14. Native Changes acceptance remains blocked by the service bundle size gate.

## Owners and changes

Node owns worktree Git text and task HEAD notifications. Changes receives an authorized root through
the task capability, projects shared porcelain and numstat into LocalStatus, takes fresh disk stamps,
and supplies exact paths and patches to the client model. Broker, cache, and renderer contracts keep
their shapes. No persisted schema changes are required.

- `packages/node-core/src/server/worktrees/taskHeadObserver.ts` owns task generations and observed
  HEADs. `taskWorktree.ts` admits authorized generations before the four-worker Git sweep. Stale
  completions return their caller's response but cannot publish notifications. Initial seeding stays
  silent, and null status preserves the previous successful HEAD. Archive claims, project deletion,
  complete roster pruning, missing paths, and root initialization retire observers. Root scope also
  fences a roster query held across reset. Filtered rosters cannot prune another active task.
- `worktreeStatus.ts` uses one unreferenced expiry timer for completed stdout. Entry identity fences
  late completion and removal. Failed placeholders and empty path maps disappear. Reset and path
  invalidation retire entries and reschedule the shared clock. Fresh reads still bypass both TTL and
  running reads. Already admitted callers retain their response, and Git work is not cancelled.
- `plugins/changes/src/server/localStamps.ts` admits eight fresh stamps per projection and preserves
  porcelain order. Mode, size, mtime, and ctime remain in the key. Each reader performs its own stats.
  Staged object keys, unknown submodule keys, gone deletions, and fresh operation markers remain.
- `gitPaths.ts` decodes C-quoted porcelain bytes with fatal UTF-8 decoding. Both shared numstat reads
  use `-z`, which separates rename paths and preserves literal arrows, braces, tabs, and newlines.
  The shared core status command stays in its original format. No cache or wire path format changes.
  Malformed escapes and unsupported encodings fail explicitly before filesystem lookup.
- `localDiff.ts` routes untracked no-index patches through `gitOrThrow` with allowed exit codes zero
  and one. `core/git.ts` and `core/proc.ts` retain spawn, timeout, cancellation, environment, and output
  completeness policy at the process seam. The 16 MiB cap remains unchanged.

Shipped contracts are documented in `docs/workspaces-and-tasks.md` and `docs/diff-rendering.md`.
The unit handoff is deleted, and the future programme index links to this implementation record.
Only files for unit 14 are included in its commit; concurrent editor, agent, and PR-marker work is
outside that commit.

## Baselines and workload

The source and probe hashes are in `unit14-before-hashes.txt` and `unit14-after-hashes.txt`.
Fresh cumulative baselines are `11-{heads,stamps,retention,paths,limits,scans}-unit14-before.json`.
Paired results use `unit14-after`. Historical investigation results remain unchanged.
The limits probe accepts a rejection after the fix so it can record the explicit error; its before
artifact retains the successful partial output. All disposable repositories disable global and
system Git configuration. The host runs Node 24.11.0 on macOS, below the repository's pinned engine
floor. Results are short synthetic workload evidence, not native latency or sustained-use evidence.

| Workload | Before | After |
| --- | --- | --- |
| HEAD A seeded, old A held, B completed, old A released, warm follow-up | B, A, B notifications | One B notification; original old caller still receives A |
| 3,000 unstaged files, cold reader | 3,000 outstanding stats; 3,003 total stats; four Git commands | Eight outstanding stats; same total stats and Git commands |
| Same warm reader | 3,001 outstanding stats; 3,003 total stats; zero Git commands | Nine outstanding stats; same total stats and Git commands |
| Four warm readers | 12,004 outstanding stats; 12,012 total stats; zero Git commands | 36 outstanding stats; same total stats and Git commands |
| 24 abandoned outputs, 16,128,000 output bytes, GC after TTL | 15,736,432 heap bytes above baseline | 372,880 heap bytes below baseline; GC noise, no retained body-sized increase |
| Five exact filename fixture | Three encoded paths miss files and yield empty patches | All exact paths exist, have stable keys, and return nonempty 33-byte patches |
| 17,825,807-byte untracked body | Successful truncated patch, final sentinel absent | Same explicit 16,777,216-byte output-cap error as tracked diff |
| 16-task sweep, two identical sweeps | Shared 16 processes; peak four | Shared 16 processes; peak four |
| Two disjoint authorized eight-task sweeps | 16 processes; peak eight | 16 processes; peak eight |

The outstanding count includes operation marker checks. Stamps do not reduce stat count. CPU in the
probe is Node CPU and excludes child Git CPU. Heap sampled at high outstanding counts is not retained
heap. The retention probe measures post-GC heap separately.

The worker comparison uses `11-stamps-unit14-bound-{8,16,32,64}.json` on the same 3,000-file fixture:

| Workers per reader | Four-reader peak stats | Four-reader elapsed ms | Node CPU ms |
| --- | --- | --- | --- |
| Unbounded cumulative baseline | 12,004 | 808 | 1,036 |
| 8 | 36 | 753 | 871 |
| 16 | 68 | 758 | 872 |
| 32 | 132 | 759 | 888 |
| 64 | 260 | 772 | 947 |

Eight workers produce the smallest admitted burst with similar fixture timing. The final paired
`unit14-after` probe overlaps repository lint and other work on the shared host: cold/warm/four-reader
elapsed times are 869/471/1,953 ms versus baseline 250/200/808 ms, and Node CPU is 375/320/1,183 ms versus
260/268/1,036 ms. Preserve that measured regression. The operation bound is reliable; these timings
do not establish a visible speedup. The selected-bound replay in `11-stamps-unit14-selected-repeat.json` also ran on the shared host and
measured 6,353/1,555/8,724 ms elapsed and 447/358/1,645 ms Node CPU for cold/warm/four-reader reads.
It preserves the eight-per-reader bound and all stat counts; the host was not quiescent.

## Verification

Exact probe commands, run from the repository root:

```bash
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs heads unit14-before
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs stamps unit14-before
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs retention unit14-before
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs paths unit14-before
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs limits unit14-before
rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs scans unit14-before
```

Repeat those commands with `unit14-after`. For worker selection, set `STAMP_WORKERS` to each of
8, 16, 32, and 64, then run the stamps command with `unit14-bound-8`, `unit14-bound-16`,
`unit14-bound-32`, and `unit14-bound-64`. Production uses eight workers.

Focused owner commands:

```bash
rtk pnpm --filter @acorn/node-core exec vitest run src/server/worktrees/taskStatusObservations.test.ts src/server/worktrees/worktreeReadLifetime.test.ts src/server/worktrees/taskWorktree.test.ts src/server/worktrees/worktreeStatus.test.ts src/server/storage/archive.test.ts src/server/projects.test.ts src/server/core/git.test.ts src/server/core/proc.test.ts --maxWorkers=1
rtk pnpm --filter @acorn/plugin-changes exec vitest run src/server/localDiff.test.ts src/server/gitPaths.test.ts src/server/localStatusAdmission.test.ts --maxWorkers=1
rtk pnpm --filter @acorn/plugin-changes exec vitest run src/server/routes/localGit.test.ts --maxWorkers=1
rtk pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts --maxWorkers=1
rtk pnpm lint
rtk pnpm test
```

- Node owner checks pass: eight files, 86 tests. They include HEAD ordering, disjoint authorization,
  null results, archive suppression, project deletion, held roster/reset, cache expiry, failed reads,
  running replacements, invalidation, and fresh refusal reads.
- Changes owner checks pass: three files, 64 tests, one Linux-only byte-filename test skipped on macOS.
  Exact keys, order, and 3,003/12,012 stat counts are independently asserted for the real 3,000-file
  cold/warm/four-reader fixture. Real Git tests cover stage/unstage/discard, quoted renames, quoted
  conflicts, deletion, submodules, chmod, restored mtime/size, UTF-8 with/without final newline, BOM
  filenames, legitimately encoded U+FFFD filenames, and explicit 17 MiB failures. Pure decoding
  assertions cover malformed and non-UTF-8 escapes on every host. The macOS sandbox refuses creating
  the invalid-byte fixture before Git runs, so the real byte-name test runs only on Linux.
- The full Changes run passes 16 of 18 files. A first BOM test run compiled its owner before the
  final owner edit, and a route fixture hook exceeded 20 seconds under shared-host load. The final
  focused run proves the BOM fix; the route replay passes all 24 tests.
- Architecture boundaries pass, 56 tests. Documentation checks initially detect another agent's README link
  to `implementation-13-agent-results.md` before that record exists. After the concurrent record
  arrives, the documentation replay passes all three tests. Unit 14's record and retired handoff
  links resolve.
- Repository lint passes all 37 tasks after fixing required task fixture fields. The final source
  check passes all 37 tasks in 2 minutes 38 seconds on the shared host.
- The bounded whole suite runs with the repository's normal three-worker/six-task settings. It does
  not pass. Socket owners report `listen EPERM` in the filesystem sandbox, fixture plugin loads fail,
  tmux checks fail, the facade snapshot differs for editor/client changes, client frame scope coverage
  misses `projectWorktreesRoute`, and a TUI editor check times out. Documentation checks initially
  observe another in-progress unit's missing record. Node/custody workers remain alive after the
  socket failures; the run is interrupted after about 11 minutes with exit 130. Only its verified
  process group is signalled. Process inspection confirms the runner and its detached worker retire.
  These are cumulative shared-branch/environment failures, not a green whole-suite gate.

`unit14-verification.txt` preserves the command summaries and concrete failed gates. The final
HEAD owner replay is `11-heads-unit14-verified.json`. All before artifacts remain unchanged.

## Native acceptance and limits

`rtk pnpm dev:agent -- --session git-filesystem-unit14` fails during service staging. The service
static graph is 3,091,366 bytes against a 3,062,000-byte ceiling. No Tauri window starts.
`rtk pnpm dev:agent:ui -- --session git-filesystem-unit14 stop` confirms the session is not running.
Real Changes navigation, filename display, stage/unstage/discard, external edits, switching, and
archive refusal remain unverified in the native window. Real Git owner tests verify those path and
mutation contracts independently. No native latency claim is made.

The string-path boundary explicitly rejects invalid UTF-8 and ambiguous replacement characters
in raw porcelain when Git disables quoting. Fatal C-quoted decoding preserves valid BOM and U+FFFD
characters; NUL numstat counts match only the exact validated porcelain paths.
It does not support arbitrary non-UTF-8 filesystem byte names. Bounded admission is per reader,
so total outstanding work scales with simultaneous independent projections. The shared expiry scan
costs a pass over live entries when its clock fires or a path invalidates. Complete stdout remains
resident inside the two-second window, and admitted callers retain their answers until settlement.
No whole-projection joining, external watchers, headless Git clock, cached refusal, cached disk stamp,
or output-cap increase is introduced. All synthetic Git processes and temporary repositories settle
and retire in the probe's finally block.
