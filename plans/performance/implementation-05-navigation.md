# Unit 05 — navigation ownership and rail projection

October 1, 2026. Source implementation and focused checks are complete for coordinator review.
Cumulative root lint/test, staged desktop/Rust, and post-change real Tauri checks remain coordinator
owned. This record does not complete the performance programme or authorize starting unit 06.

## Architecture and changes

The implementation follows report 07, the implementation contract, and the unit 05 review brief.
The owning flow is selected Node → QueryClient partition → shell lease → compiled pane model →
independently mounted regions. Notes and Terminal retain the originating Node for asynchronous work.
No Node API/protocol/auth/custody or persisted preference representation changes were required.

| Owner/files | Change and reason |
| --- | --- |
| `client-core/host/registries/panes/paneModels.ts`, `panes.ts`, new `PaneModelHost.tsx`; client-core package export; desktop `client/index.tsx` | Registry-owned shell lease inside the selected QueryCacheProvider. One current task model per pane, shared across regions. Captured Node generation qualifies reuse and drawn marks. Pane/region removal retains the model; task replacement/eviction, outgoing Node eviction, or host/provider destruction disposes it. Late lease/mark release cannot affect an equal-ID replacement. Failed construction disposes its partial root. The TSX component has an explicit leaf export, independent of persistence lifecycle. |
| `client-core/infra/node/activeNode.ts`; shell `scopeEviction.ts`; desktop `scopedEviction.ts` | Batch signal, remembered-device write, and switch event. Interest still precedes the equal-selection guard. Listeners read B while A DOM exists; captured `from` retires outgoing owners before B constructs. |
| Node `apiClient.ts`, `public.ts`; plugin-api `client.ts` | Expose unit 04's pure QueryClient→Node ownership lookup. Read options accept captured null, consistent with existing mutation custody: undefined is ambient, null is no target with a broker or the serving origin without one. |
| Notes `notesClient.ts`, `notesPaneState.ts`, `notesModel.ts`, new `noteDrafts.ts` | API factory captures Node; selection uses Node+task. Workspace query and all Notes verbs retain origin. Read/create publication, remembered selection, refetch/focus, and save UI acknowledgements are generation/disposal guarded. Both debounce timers flush. Held navigation reads flush intervening edits before replacing the selected document; failed reads retain it. Virtual creation can finish/save on A after retirement without selecting/focusing B. |
| Notes `noteDrafts.ts` | Feature-owned recovery by Node + full scope address + slug. Exact local edit acknowledgements, one active save plus latest dirty follow-up, and a shared document queue for body/title/inclusion/delete. Dirty state is uncapped. Clean owners are released after their current reader and queued operations finish. |
| Terminal `terminalClient.ts`, `wsChannel.ts`, `liveXterm.ts`, `TerminalSurface.tsx`, `TerminalPanel.tsx`, `sessionStore.ts` | Capture API/input/attach/resize origin, qualify slots by Node+session, send captured cleanup with `cleanup:true`, and make disposal/late callbacks harmless. Failed rosters retain rows/attention/xterms. Panel profile/create/close/focus work captures view generation; initial failures settle loading and skip automatic creation after failed freshness. Actual prime/clear/release/build ordering is tested. |
| `client-core/features/tabs/TabRail.tsx` | Scalar raw preference memo → one parsed order memo → shared pin Set. Reactive marker getters and row identity remain intact. |
| plugin-api `testkit/client.ts` | Plain client test seam exposes real fleet refresh for origin/status fixtures. Test preference writes use the production `savePref` seam. |

Same-Node hidden tabs and parked terminals remain **LIVE** and reuse their xterm. Four WebGL contexts
remain bounded. No visibility detach, raw-ring continuity reduction, or hierarchy/project-map rewrite
was introduced. Unit 03 still owns viewer retirement and forwarding; unit 04 owns persistence.
The portable PaneModelHost seam is available for unit 27's complete TUI Node provider composition.
Unit 16 remains the owner of general host/file editor recovery.

### Notes serialization and recovery tradeoffs

Node Notes writes remain atomic file replacement without expected-revision/CAS conflict tokens.
The previous Notes documentation incorrectly claimed server conflict detection; it now describes the
actual contract. Local revisions acknowledge exactly the body/title edit sent, without changing the
protocol. Ordering protects this renderer's separate read/modify/write mutations; another client or
manual external writer can still replace the file.

Each edit is immediately owned in memory. Device recovery serializes at most one scheduled batch
per 250 ms, with forced flush at navigation, retirement, acknowledgement, and failure. Abrupt process
loss can lose that unflushed interval. Blocked/quota-exhausted storage keeps this renderer's in-memory
copy but cannot guarantee restart recovery. Dirty drafts have no arbitrary count/text cap. Returning
overlays pending/failed text and error; a new edit or explicit save retries. There is no background
offline replay. Recovery addresses include the complete scope location and captured Node.

## Evidence validity and preserved inputs

Original report 07 artifacts remain untouched. The original `07-probe.config.ts` directory alias for
Tanstack selected its CJS `main`, splitting the Solid runtime from the ESM renderer. Affected original
owner/disposal claims are superseded by the corrected cumulative baseline below, rather than used as
gains. Early expanded harness attempts that reconstructed TabRail or failed duplicate context-menu
registration remain diagnostic only. Their counts/CPU are excluded.

`05-probe.config.ts` uses the explicit installed `@tanstack/solid-query/build/dev.js` ESM entry, normal
QueryClientProvider, actual component construction, browser/development conditions, and one worker.
Runtime identity is true in both accepted cohorts. Rail construction is one per mount/phase, with
stable row DOM. No frozen tree or direct hand-call substitutes for the production component.

- Production cumulative pre-05 hashes: `unit05-source-cumulative-before.json` (17 owner files after
  accepted units 01–04; captured before source edits).
- Accepted expanded ESM baseline: `05-*-unit05-cumulative-before-esm.json`, with
  `unit05-probe-cumulative-before-hashes.json`. Clean-debug baseline used for comparisons:
  **`05-*-unit05-clean-before.json`** and `unit05-probe-clean-before-hashes.json`.
- Exact clean baseline probe bytes: `evidence/unit05-baseline-probe-source.txt`.
- CPU pairing replays those exact bytes against repaired production owners:
  **`05-rail-host-unit05-clean-paired-after.json`**, `unit05-probe-paired-after-hashes.json`.
  Both probe SHA256s are `c63b8ee8c425f477c74b2b7e2f670d712abd58c8a16784d1733a41840ae54f4c`;
  both config hashes are `f703e470189316bfa76f7998d9e040da81fb485306d9376c9e05bf8228c3be29`.
  This literal paired replay retains the old provider-only owner diagnostic; its final-disposal
  numbers are **not** the proof of the adopted composition.
- Final adopted-host/origin/pin/large-recovery proof: **`05-*-unit05-final-owner-after.json`**,
  `unit05-probe-after-hashes.json`, `evidence/unit05-final-probe-source.txt`.
  The restored working probe uses PaneModelHost and asserts final owner disposal.
- Final production/lasting-test/unchanged broker-hub-display hashes: `unit05-source-after.json`.
  `unit05-evidence-hashes.json` records SHA256s for 45 accepted artifact/hash/log/source-snapshot files.
  Final consistency check verified 35 source files, identical CPU pair hashes, and restored final probe.
  `git diff --check` exits 0.
- `unit05-first-after` is diagnostic: it lacked adopted host cleanup and overlapped a type run.
  Its CPU is explicitly excluded. `unit05-final-after` has valid rail/owner counts, but its large-note
  elapsed values used a fake clock; that artifact is superseded by `unit05-final-owner-after`, which
  retains a bound native clock before installing fake timers.

The accepted before and all final performance runs had no competing coordinator build/native work.
The clean paired after and final owner measurements had no other local tests/type checks running.
The standalone broker/hub/display replay runs were sequential. Its first sandbox attempt was denied
local `listen` with EPERM; authorized ephemeral-loopback runs then completed with cleanup.

## Measured owner results

| Actual owner observation | Clean cumulative before | Final adopted composition |
| --- | --- | --- |
| A/B equal task ID | B draws `node-b:node-a`; one model | B draws `node-b:node-b`; independent model |
| Outgoing A / incoming B query observers | 1 / 0 | 0 / 1 |
| Invalidate A after switching | One HTTP request goes to B and caches B into A | No request; A cache stays A |
| Final shell destruction | Detached C observer remains 1 | 3 built models / 3 disposed; observers 0; drawn models 0 |
| Switch event DOM | Incoming DOM already exists | Event sees incoming active Node with outgoing DOM; disposal precedes incoming construction |
| Notes retirement | Body sends to B; title sends to B after its 800 ms deadline | Body/title send to A immediately through serialized cleanup; no later title timer write |
| Actual terminal channel | A attach survives locally with no captured detach | One A `cleanup:true` detach; late A release cannot detach colliding B |

The lasting owner tests include repeated lease/mark release, returning equal IDs, partial builder
failure/retry, provider observer disposal, held Notes read/create/write races, failed virtual scratch
and body/title recovery, exact acknowledgements, and late title focus. The terminal suites preserve
warm parked output, DOM/xterm identity, all supported output, four contexts, and real headless-xterm
alternate-screen/reset/restore assertions. The new session-store owner fixture exercises actual
initSessions prime, channel retirement, clear/release, B construction, and successful B roster.

### Rail operation counts and CPU

Actual TabRail, real QueryClient/device preference writes, 6/100/300 representative tasks and 1000
stress tasks. The stored representation is identical. Mount parse counts are 13/201/601/2001 → 1.
Selection parses are 1 → 0 at every size. Same-value/unrelated preference parses are
7/101/301/1001 → 0. Changed pin order parses are 13/201/601/2001 → 1. Construction count stays 1;
first row DOM is retained. The final host fixture asserts that reactive pin legends switch to task-1.
Project/hierarchy traversal remains unchanged.

CPU below is process user+system CPU in milliseconds for the same action/wait boundaries and exact
probe/config bytes. Elapsed includes a ~5 ms fixture settle, so it is reported separately in JSON.
Cold imports/transforms, mount CPU, layout/paint, and real navigation latency are outside the window.
Single samples include GC/scheduling variation; counts support the optimization more reliably than
small CPU differences.

| Tasks | Same value CPU before → after | Unrelated pref CPU before → after | Changed pins CPU before → after |
| --- | --- | --- | --- |
| 6 | 1.791 → 0.618 | 1.893 → 1.090 | 4.118 → 3.720 |
| 100 | 6.725 → 0.763 | 4.287 → 1.789 | 18.354 → 8.179 |
| 300 | 45.505 → 11.937 | 21.664 → 2.575 | 163.688 → 19.054 |
| 1000 stress | 110.399 → 8.481 | 101.842 → 6.022 | 203.891 → 100.656 |

### Large Notes recovery

`05-notes-large-recovery-unit05-final-owner-after.json` edits a 300000 UTF-16-code-unit synthetic body
100 times. Final body is 300002 code units / **600002 UTF-8 bytes**, retained without truncation.
The input loop performs zero recovery serializations/storage writes: CPU 0.366 ms, elapsed 0.217 ms.
One 250 ms scheduled flush costs CPU 1.905 ms / actual elapsed 1.450 ms; retirement adds one forced
flush. Total recovery serializations and no-op storage calls are **2**, not 100. This is JavaScript
CPU and synthetic storage invocation cost, not filesystem latency. Held-save tests retain one active
operation and coalesce 100 repeated save requests into first + latest body writes; title and queued
inclusion remain ordered. No heap-byte reduction is claimed. Lifetime memory evidence is final zero
roots/observers/drawn owners and bounded renderer counts; uncapped dirty recovery is an explicit cost.

### Terminal transport/display replay

`05-terminal-sink-probe.mts` explicitly adapts the old sink probe, whose wait for 128 inactive
forwarded frames no longer matches unit 03. It replays captured actual channel frames through actual
NodeBroker, wsHub and TerminalDisplay over an ephemeral loopback server, with a synthetic screen.
Inputs/results: `05-terminal-switch-unit05-clean-before.json` →
`05-terminal-sink-unit05-cumulative-before.json`; final captured channel sequence →
`05-terminal-sink-unit05-after.json`.

Both cohorts have initial one canonical snapshot and return one new canonical snapshot, ordered
ready → reset-prefixed snapshot → live output. Main inactive forwarding remains **0 before and after**
(unit 03's gain). A modern sibling retains one sink and all 128 live frames / 528896 encoded bytes.
Final modern sinks are 0, screen factories/disposals 3/3; older Node final sinks are 0, 2/2.
Post-change captured cleanup is rejected after viewer retirement instead of reacquiring it. Older
Node compatibility and logical sibling ownership are preserved. CPU/elapsed samples in the transport
JSON are diagnostic, with no unit 05 forwarding or native latency gain claimed.

## Verification commands and results

All shell commands use RTK. `--config.verify-deps-before-run=false` preserves the coordinator's managed
install metadata workaround. No install, dependency upgrade, branch, commit, native staging, paid
provider request, or normal/private profile was used by this specialist.

```sh
rtk proxy env ACORN_PERF_TAG=unit05-clean-before pnpm --config.verify-deps-before-run=false --filter @acorn/desktop exec vitest run --config ../../plans/performance/05-probe.config.ts
rtk proxy env ACORN_PERF_TAG=unit05-final-owner-after pnpm --config.verify-deps-before-run=false --filter @acorn/desktop exec vitest run --config ../../plans/performance/05-probe.config.ts
rtk proxy env ACORN_PERF_TAG=unit05-clean-paired-after pnpm --config.verify-deps-before-run=false --filter @acorn/desktop exec vitest run --config ../../plans/performance/05-probe.config.ts
rtk proxy env ACORN_PERF_TAG=unit05-cumulative-before ACORN_PERF_FRAMES=05-terminal-switch-unit05-clean-before.json node --import ./apps/desktop/node_modules/tsx/dist/loader.mjs plans/performance/05-terminal-sink-probe.mts
rtk proxy env ACORN_PERF_TAG=unit05-after ACORN_PERF_FRAMES=05-terminal-switch-unit05-final-owner-after.json node --import ./apps/desktop/node_modules/tsx/dist/loader.mjs plans/performance/05-terminal-sink-probe.mts
```

All exit 0: before 5/5; final owner 6/6; literal paired after 5/5; two bounded sequential sink replays.
The paired command runs while the saved baseline bytes are restored, with a finally-restored final
probe; hashes above prove the exact pairing. Original inputs/artifacts are preserved.

```sh
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/client-core exec vitest run src/host/registries/panes/paneModels.test.tsx src/host/registries/panes/panes.test.tsx src/host/registries/shell/scopeEviction.test.ts src/infra/node/activeNode.test.ts src/features/tabs/TabRail.test.tsx src/features/tabs/railOrder.test.ts src/features/tasks/TaskPaneHost.test.tsx src/features/tasks/tasks.test.ts src/features/workspaces/fleetWorkspaces.test.ts src/features/workspaces/lastWorkspace.test.ts src/features/workspaces/workspaceViewTransition.test.ts src/host/registries/rail/railMarkerFeed.test.ts src/features/tabs/railMarkers.test.ts
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/plugin-notes test
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/plugin-terminal exec vitest run src/client/wsChannel.test.ts src/client/sessionStore.test.ts src/client/sessionStoreOwner.test.tsx src/client/TerminalPanel.test.tsx src/server/terminalDisplay.test.ts
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/arch-tests test
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/client-core --filter @acorn/plugin-api --filter @acorn/plugin-notes --filter @acorn/plugin-terminal --filter @acorn/desktop lint
rtk proxy pnpm --config.verify-deps-before-run=false exec oxlint apps/desktop/src/client/index.tsx apps/desktop/src/client/scopedEviction.ts packages/client-core/src/host/registries/panes packages/client-core/src/host/registries/shell/scopeEviction.ts packages/client-core/src/infra/node/activeNode.ts packages/client-core/src/infra/node/apiClient.ts packages/client-core/src/infra/node/public.ts packages/client-core/src/features/tabs/TabRail.tsx packages/plugin-api/src/client.ts packages/plugin-api/src/testkit/client.ts plugins/notes/src/client plugins/terminal/src/client
```

All final exit 0: core 13 suites/100 tests; Notes 9/41; terminal 5/42; architecture 5/67; five-package
lint/types pass (102 eager icons, 18273 B). Targeted oxlint has warnings, including mutation-snapshot
spread checks and pre-existing TabRail warnings, but no errors. Earlier expected-test updates,
fixture origin statuses, cross-package relative test imports, and held-Promise type errors were
fixed and replayed. Final logs are under `evidence/unit05-*.log`.

Owning docs updated: `docs/panes.md`, `frontend.md`, `state-ownership.md`, `terminal.md`,
`notes-and-memory.md`. Architecture/protocol/custody boundaries remain covered by the 67-test suite.

## Remaining concrete coordinator gates

1. Review this unit and run cumulative root `pnpm lint` and bounded `pnpm test` using the existing
   metadata workaround; then staged desktop/Rust and bundle budget checks.
2. Stage the repaired renderer and inspect real isolated Tauri snapshots/screenshots for Notes,
   task/Node transitions, and Terminal. The coordinator's fresh pre-05 Terminal click/Shell profile
   and prompt screenshot succeeded; the old click hang did not recur. That run did not establish
   valid native/document focus, so no visible-latency before/after gain is claimed. Native fixtures
   were stopped before these measurements; the specialist launched none.
3. Unit 27 adopts the shared host lifetime in complete TUI Node provider composition. Unit 16 handles
   the separate general file editor/draft recovery programme.
