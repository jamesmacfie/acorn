# Trim evidence and handoffs

Date: 2026-10-06. Status: phases 01–12 complete; phase 13 is next.

## Phase 12 provider processes (2026-10-06)

Implementation base: `f40c391fbdedf7335e84f94dc498d909ae5d1d01`, branch
`phase-12-own-provider-process-lifecycle`, Darwin arm64, Node 24.21.0 from
`/private/tmp/acorn-trim-node-bin`, pnpm 11.0.0. `CI=true pnpm install --frozen-lockfile` passed
with cache and network permission: 426 package copies reused, none downloaded, and no lockfile change.
No dependency, database, public route, protocol, plugin API, or persisted identifier changed.

`providerSessionLifecycle.ts` owns the only mutable live map, process generations, per-generation
start and stop joins, callback work, readiness holds, and reconnect, quiet, idle, and footprint timers.
The engine supplies specific task, workspace, history, scoped-environment, MCP, durable callback,
and telemetry ports. Its original redaction array still feeds the same materializer instance. The
queue coordinator retains scan and delayed-head ownership and phase 11's monotonic `started` update.
Product commands and the queue use immutable facts, checked generation operations, and handle
commands executed by the owner. An internal generation field in pending durable events prevents an
older buffered completion from clearing a successor's active marker or turn span.

The shutdown order is engine abort and owner timer clear, queue admission close, all owned child
retirements, queue drain and callback joins, durable event and search flush, publication callback
joins, then webhook stop before the plugin database closes. `runtimeStartup.test.ts` holds a provider
callback inside the durable
write: stop remains pending after the child stop is observed, then the callback commits. The test
closes the plugin database, opens a fresh connection and engine in the same process, reconciles, and
proves the committed event is readable while the stopped generation's later callback is ignored. A
second case makes disconnect retirement throw `ProcessRetirementError` and proves replacement and
shutdown both reject that failure. Held startup warning and webhook queue writes show that stop joins
durable and publication work before storage closes. Other startup cases cover held reads, readiness,
a driver that ignores cancellation and returns a late handle, and stale callbacks. Driver process-ownership cases
exercise real process groups. The real Node `src/composition/runtime.test.ts` repeats service boot
against one data root after stopping the previous runtime; it has no active agent child, so the
active-child retirement proof comes from the focused driver and engine tests.

Focused gates on the supported runtime passed: startup 16 tests, idle and footprint 10, queue 12,
driver process ownership 15, telemetry 6, durable buffer 3, materializer 2, and real Node repeated
runtime boot 3. The final bounded agents suite passed 150 files and 1,099 tests with one skipped;
workflows passed 64 files and 553 tests; Node passed 40 files and 273 tests; TUI passed 68 files and
673 tests with two skipped; desktop passed 28 shell files and 171 tests, 10 built boot tests, and
62 Rust tests. `TURBO_FORCE=true` bypassed unsupported-runtime cache. The five-package run used
`VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2` and zero cached tasks. Its TUI reachability frame
exceeded the harness's 500 ms settle limit while agents and TUI shared the machine. A standalone
bounded TUI package run passed all 68 files and 673 tests. No TUI source changed.

The first standalone desktop stage measured the service's boot-time static graph at 3,290,481 B,
481 B above its existing 3,290,000 B ceiling. Process and disk footprint logic now loads when
measured rather than at service boot. The final standalone desktop gate passed with a 3,288,688 B
static graph, 1,312 B under the unchanged ceiling. No budget or warning override was used. This
phase's final `TURBO_FORCE=true pnpm lint` passed 37 of 37 tasks with zero cached. Architecture
`pnpm --filter @acorn/arch-tests test` passed 12 files and 86 tests after source and docs staging.
The root test, build, and pack gates remain phase 15's work.

## Phase 11 agent admission (2026-10-06)

Implementation base: `855494989`, branch `phase-11-separate-agent-turn-admission`, Darwin arm64,
Node 24.21.0 from `/private/tmp/acorn-trim-node-bin`, pnpm 11.0.0. A frozen `CI=true pnpm install
--frozen-lockfile` passed with cache and registry access: 426 packages reused, none downloaded.
The initial sandbox attempt could not resolve the registry. No package declaration, lockfile,
database history, route, wire contract, plugin API, or staged payload changed, so the phase 01
dependency and payload measurements are unchanged.

`queueCoordinator.ts` owns queue scans, requested repumps, fairness streak, delayed wake, and drain.
Its ports call durable `queuedHeads`, `getSession`, `requireSession`, and `nextQueuedTurn` reads;
fresh preference limits; live occupancy and workspace resolution; provider startup and generation
ownership; dispatch; and shutdown. `runtime.ts` still accepts turns durably before requesting a
scan. `runtimeEngine.ts` retains event buffering, accepted-response tracking, retry classification
and the three-attempt ceiling, usage continuation, and provider retirement. Phase 12 must replace
the engine-backed `occupancy`, `live`, `ensureSession`, `ownsSession`, and `stopLive` ports and the
dispatch path's live handle, driver, controller, `activeTurnId`, and `acceptedResponse` accesses.

Focused results on the supported runtime: `runtimeQueue.test.ts` 11, `runtimeStartup.test.ts` 12,
`runtime.test.ts` 39, `sessionExecute.test.ts` 17, workflow
`workflowAgentSession.test.ts` 7, and Node `workflowActivation.test.ts` 1 passed. The managed
execution test runs `createSessionExecute` through `ManagedAgentRuntime`; the workflow tests cross
the late-bound capability with a controlled provider. The runtime suite includes usage continuation
with the same turn ID, safe retry, delayed wake, limits, and a fruitless-scan repump. Two added runtime
cases prove that a classified transient failure does not retry after accepted output or after three
attempts. The added queue cases
prove a public enqueue during a held workspace read, workflow admission after five interactive
dispatches, and two start/cancel cycles followed by stop and a new runtime on the same fixture
database. The new runtime dispatched accepted work without the stopped runtime's callback.

The first bounded five-package consumer run passed workflows, but sandbox restrictions caused
`listen EPERM` in Node, TUI, and desktop and hid the current process from an agents footprint test.
The same command passed with host permissions, `TURBO_FORCE=true`, two Vitest workers, and two
concurrent package jobs: workflows 64 files/553 tests, agents 150 files/1,091 tests and one skipped
before the final fairness and retry cases,
TUI 68 files/673 tests and two skipped, Node 40 files/273 tests, and desktop 28 files/171 tests,
10 boot tests, and 62 Rust tests. Zero package tasks used cache. Root `pnpm lint` passed 37/37
tasks with zero cached after correcting an unused import, a test event type, and test type inference.
The agents package was rerun after the final cases and passed 150 files/1,094 tests with one skipped.
Architecture `pnpm --filter @acorn/arch-tests test` passed 12 files/86 tests after this evidence
anchor was added. The full root test, build, and pack gates remain phase 15's work.

### Scan progress correction (2026-10-06)

Correction base: `cdd2fc506366b78d48dd8e1c3102eb91353b3390`. The extracted scan assigned
`started` from each dispatch result. When an earlier dispatch succeeded and a later held preparation
lost its provider generation, the later `false` erased the earlier `true`; without another pump
request, the scan ended before it read the first session's next durable head. The coordinator now
awaits every dispatch and retains `started` once any dispatch in the pass returned `true`.

The added `ManagedAgentRuntime` case prestarts two sessions, queues two turns for the first and an
attachment turn for the second, then requests one scan. It holds the second turn's attachment read
after the first turn dispatches. Public `stopTaskSessions` calls retire both generations without a
queue trigger; releasing the read makes the second dispatch return `false`. The first session's next
durable head requires the follow-up scan. The focused test failed on the original assignment with
only the first send observed, then passed with the monotonic assignment. It uses held promises and
observable sends, not a delay or coordinator-private state.

The supported-runtime focused gates passed: `runtimeQueue.test.ts` 12 tests,
`runtimeStartup.test.ts` 12 tests, and `runtime.test.ts` 39 tests. Architecture passed 12 files/86
tests through `pnpm --filter @acorn/arch-tests test`. This correction changes no dependency,
payload, schema, API, fairness, or retry measurement.

Root `TURBO_FORCE=true pnpm lint` passed 37/37 tasks with zero cached. The first agents package run
overlapped lint and had one timeout in the unchanged 2,500-event workflow capture case; the new
queue test passed in that run. The capture case passed alone in 2.1 seconds, and the bounded agents
suite passed without competing lint: 150 files, 1,095 tests passed, one skipped, zero cached.
The correction did not rerun desktop, TUI, the full root suite, build, or pack.

## Phase 10: plugin host contributions (2026-10-06)

Implementation base: `df22f225dcdbe712b269f2fbb9f19ff2b65bdbd5`, Darwin arm64,
Node 24.21.0 from `/private/tmp/acorn-trim-node-bin`, pnpm 11.0.0. The frozen install passed with
registry access after an initial sandbox attempt failed DNS resolution. It reused 426 package copies,
downloaded none, and did not change the lockfile. This phase changes no plugin API, route, stored ID,
database migration, or permission grant.

The [phase 10 completion note](./10-plugin-host.md) maps adapters, lifetime state, and cleanup.
`host.ts` shrank from 805 to 644 lines while retaining the boot and reload transaction. Registrations
still use owner-bound contexts. A duplicate loaded hook in the pre-init registration pass is contained
after its first hook is removed; a compiled init that registered a route fails boot and clears that
route. Late hook, extension-point, schedule, and emits disposers preserve the successor registration.

| Gate | Result |
| --- | --- |
| `pnpm test:focus @acorn/node-core src/server/pluginHost/host.test.ts` | Passed, 41 tests after compiled-failure and shutdown-context regressions. |
| `pnpm test:focus @acorn/node-core src/server/pluginHost/schedules.test.ts` | Passed, 5 tests. |
| Focused `taskChecks.test.ts`, `hooks.test.ts`, `search.test.ts`, and `extensionPoints.test.ts` | Passed, 13, 16, 2, and 6 tests. The package suite also ran scheduler generation and harness contributions. |
| `pnpm test:focus @acorn/node test/integration/plugins/runtimeContributions.test.ts` | Passed, 4 tests. The real loaded worker served a scoped tool call, failed in candidate `ready` while the old worker served, reloaded successfully, disabled on the next boot, and shut down. Registry entries disappeared at disposal; four worker terminations were observed across failed candidate, retired old instance, shutdown, and disabled load. |
| `TURBO_FORCE=true pnpm lint` | Passed, 37 tasks, zero cached, after correcting the test's branded extension-point ID and the host's context map type. |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test --filter=@acorn/node-core --filter=@acorn/node --filter=@acorn/cli --filter=@acorn/tui --filter=@acorn/desktop` | Passed with loopback and process permission: five packages, zero cached; desktop included 62 Rust tests. The first sandbox run encountered `listen EPERM` in Node, CLI, TUI, and desktop and was stopped before its remaining tasks ended. |
| `pnpm --filter @acorn/arch-tests test` | Passed after staging the changed docs and source. |

The loaded fixture has no migration chain; host tests cover loaded storage reuse, access during
`dispose`, and closed handles afterward. The fixture does not assert an OS process ID because the
loaded realm is a worker thread; termination calls and removed registrations are observable. This
phase did not run the full root test, build, or pack gates assigned to phase 15.

## Phase 09: workflow activation (2026-10-06)

Implementation base: `b7c905cf7c24fcf4ef68293c6a6a8d3b3c786627`, branch
`phase-09-thin-workflow-activation`, Darwin arm64, Node 24.21.0 from
`/private/tmp/acorn-trim-node-bin`, pnpm 11.0.0. `CI=true pnpm install --frozen-lockfile`
completed with registry access: 426 package copies were reused, none downloaded, and the lockfile
stayed fixed. The initial sandbox install could not resolve npmjs.org and was cancelled before its
network-enabled retry. This phase changes no manifest, public contract, migration, or stored ID.

The activation closure map is in the [completion note](./09-workflow-activation.md#completion-note-2026-10-06).
The runner's managed, GitHub, notes, and terminal capabilities are still read per call. Internal
context fetch still uses service scope and returns an empty block on a failed response. Headless
execution keeps the task-scoped tool ceiling and abort signal. The start/control barrier still waits
for post-listener reconciliation; dispatch recovery precedes runner recovery, then schedule recovery.

| Gate | Result |
| --- | --- |
| Focused Node `workflowRunner.test.ts`, `workflowTasks.test.ts`, `workflowFiles.test.ts` | Passed: 25, 1, and 5 tests. These suites exercise the runner and definition behavior but construct some owners directly. |
| Focused workflow publication `service.test.ts` and `draftQueries.test.ts` | Passed: 10 and 4 tests. |
| Focused schedule `service.test.ts`, processing `store.test.ts`, nested `workflowNestedDispatch.test.ts` | Passed: 19, 13, and 8 tests. The nested suite includes 500 descendants with four agent slots. |
| Focused Node `workflowActivation.test.ts` | Passed: the activated plugin registered route capabilities, held a start behind reconciliation, used a late-provided managed session and real notes store, returned empty HTTP context on a failed fixture response, failed a policy gate with no GitHub provider, and propagated cancellation and plugin teardown to managed requests. No live network was used. |
| `TURBO_FORCE=true pnpm lint` | Passed, 37/37 tasks, zero cached. |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test --filter=@acorn/plugin-workflows --filter=@acorn/node --filter=@acorn/tui --filter=@acorn/desktop` | Passed, 4/4 packages, zero cached, after enabling loopback/process access. The first sandbox run failed Node, TUI, and desktop socket tests with `listen EPERM`; it did not expose a workflow regression. |
| `pnpm --filter @acorn/arch-tests test` | Passed, 12 files/86 tests. An initial test placement and an undeclared test-only import were corrected before the passing run. |

The phase does not repeat the root test, build, or pack gates; phase 15 owns those combined checks.
It did not launch a live provider or a desktop UI. The activation fixture checks schedule bridge
defaults and registration; the schedule service suite checks occurrence deduplication and settlement.

## Phase 07: rail task editing (2026-10-06)

Implementation base: `6d6aefcbf`, Darwin arm64, Node 24.21.0 from
`/private/tmp/acorn-trim-node-bin`, pnpm 11.0.0. The phase retains task routes, payload fields,
menu IDs, preferences, and the one Node query cache. No database or public protocol migration.

| Fact | Owner after extraction | Lifetime |
| --- | --- | --- |
| Visible tasks, sources, menus, drag, hierarchy, navigation, shortcuts | `TabRail.tsx` | Mounted rail |
| New task project options and initial project, rename task, origin Node | `TaskDraft` passed by rail | Captured when dialog opens |
| Title, icon, branch text/touched state, base, source mode, worktree pick, setup choice, errors, saving | `taskDraftStore.ts` | One dialog mount |
| Project config, branches, free worktrees, availability answer | Dialog Solid resources, with explicit Node target | One dialog mount and request identity |
| Task roster revision | Rail's existing TanStack query, read by dialog | Node cache scope |
| Task create, setup notification, rename | Existing task mutation and bridge with optional captured Node | One submission |

Availability identity includes Node, project, branch, base branch, and exact/derived source. A
superseded or disposed request cannot enable submission. Creation and rename use the captured Node;
post-write invalidation, activation, and navigation check that the dialog still exists and the Node
has not changed. A workspace switch keeps the dialog's project list. Server validation remains the
final branch authority, and a failed availability read still permits submission.

A transport-level regression holds task creation on Node A, switches the active Node to B, then
releases the response. It verifies that the setup notification still goes to A. This covers the
create-to-setup await boundary with the real mutation and bridge, where the rail's mocked mutation
cannot observe routing.

| Gate | Result |
| --- | --- |
| `pnpm test:focus @acorn/client-core src/features/tabs/TabRail.test.tsx` | Passed, 18 tests. Held availability after reopen and right-click selection/drag cases added. |
| `pnpm test:focus @acorn/client-core src/features/tasks/taskMutations.test.ts` | Passed, 1 test. Held create response across an active Node switch; setup request retained the origin Node. |
| `pnpm --filter @acorn/client-core lint` | Passed after the captured-Node regression. |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test --filter=@acorn/client-core` | Passed after the captured-Node regression, 315 files/2,403 tests, zero cached. |
| `TURBO_FORCE=true pnpm lint` | Passed, 37/37 tasks. |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test --filter=@acorn/client-core --filter=@acorn/tui --filter=@acorn/desktop` | Original phase run passed with listener access, 3/3 packages, zero cached. Client-core then: 314 files/2,402 tests. TUI: 68 files/673 passed, two skipped. Desktop: 28 files/171 tests, helper 10 tests, and 62 Rust tests passed. Initial sandbox run failed socket tests with `EPERM`. An intermediate run exposed a stale config mock in the held-request fixture; the corrected fixture and final combined run passed. TUI and desktop suites were not repeated for the regression-only follow-up. |
| `VITEST_MAX_WORKERS=2 pnpm --filter @acorn/arch-tests test --maxWorkers=2` | Passed, 12 files/86 tests. |

Desktop host: `trim-07-fixture`, generated `tui-navigation` Git fixture. Created a project-folder
task, renamed it through the rail menu, created a new worktree from an exact branch after observing
`main` conflict and disabled Create, and adopted a linked worktree created in the fixture. The
resulting task routes, rail entries, and branch labels appeared in driver snapshots. Inspected the
[rail screenshot](./artifacts/phase-07-rail-tasks.png) and [conflict screenshot](./artifacts/phase-07-conflict.png).
The documented desktop driver handles click and fill, but not hover, right-click, drag, or native
keyboard input. Native Computer Use could not bind this test window (`cgWindowNotFound`); focused
rail tests cover those pointer behaviors. Both desktop sessions were stopped.

TUI host: `trim-07-tui` used the same generated fixture, opened **New task** through Ctrl+K,
entered a title, observed the derived branch, created the task, and saw the roster grow from two to
three at 120×40. Ctrl+B hid the rail in a live snapshot. The fixed-roster navigation flow rejected
the modified fixture's three tasks, so a fresh `trim-07-nav` fixture ran it successfully: agent and
Changes panes, workspace picker and switch, help, and the [120×40 rail view](./artifacts/phase-07-tui-wide.txt).
The TUI has a separate setup form and no task rename command. Both TUI sessions were stopped.

## Historical investigation

The audit inspected revision `5f2cec506`. Planning rechecked owners at `2ae55abb5`.
The intervening change remembered the transcript's Chats only filter per session; phase 06 must
preserve it. Measurements below describe the audit checkout, not a fresh installed release.

| Measure | Observed | Definition or limitation |
| --- | --- | --- |
| Workspace packages | 36 | Root manifest excluded. |
| First-party plugins | 21 | Plugin workspace packages. |
| Production files / lines | 2,182 / 250,050 | TS, TSX, Rust, CSS, MJS in apps, packages, plugins, tools; generated/vendor/test code excluded. |
| Production TS/TSX files / lines | 2,079 / 233,639 | Same exclusions; median 70 lines; 47 files above 500 lines. |
| Production files at most 300 lines | About 92% | TS/TSX census. Small files are evidence about shape, not proof of simplicity. |
| Source test files | 1,100 | Test/spec files; testkit helpers counted separately. |
| Unique direct external names | 79 | 37 manifests including root; 61 production and 18 development-only names. |
| Locked entries / unique names | 566 / 528 | Version/peer snapshots, including optional platform packages. |
| Production closure entries / names | 285 / 283 | Union from external production importer roots; includes resolved peers and optional edges. |
| Development-only closure entries / names | 281 / 245 | Development closure minus production closure; not everything marked dev in a manifest. |
| Runtime staging closure size | 327.8 MiB | 112 installed package copies, macOS arm64; uncompressed package files, nested node_modules excluded per copy. |
| Claude adapter closure size | 244.8 MiB | Overlapping subset of staging closure; 103 installed package copies. |
| Optional Claude arm64 binary | 216.7 MiB | Installed SDK binary package; omission is not yet proven safe. |
| node-pty package size | 61.4 MiB | Windows prebuild directories accounted for about 57.7 MiB on this macOS checkout. |

The dependency closures overlap. Never add branch sizes to estimate total savings. Removing a direct
declaration may remove no locked package: Solid still requires seroval, for example. Lock entries are
neither installed package copies nor shipped bytes. Rust's lockfile was also substantial, but the
audit did not establish unused Tauri crates. No fresh vulnerability audit was performed.

## Structural findings

- Workflow value imports formed a six-module strongly connected component around file definitions,
  built-in execution, resolution, and incremental processing. Agent pane selection formed a
  three-module component through the pane ID import.
- `TabRail.tsx` had 750 lines and mixed task editing with queries, menus, ordering, and rendering.
  `AgentComposer.tsx` had 776 lines and mixed rendering with asynchronous draft operations.
- Workflow activation had 689 lines; plugin host initialization lived in an 805-line host file.
- Agent engine and runtime files had 1,312 and 813 lines respectively. Inheritance exposed mutable
  process, scheduling, and shutdown state to product commands.
- GitHub project identity and task pull relations appeared in core storage and public transport.
  Generic external-item and project mapping models already exist; a migration needs a concrete need.

Paths and counts are dated evidence. Phase 01 must retain its exact exclusion list, graph resolution
rules, scripts, and raw summaries so phase 15 can repeat the same method.

## Verification already performed

On Node 24.11.0, `pnpm --dir tools/arch exec vitest run --maxWorkers=2` passed 11 files and 85 tests.
This runtime did not meet the root's supported Node 24 floor. Full tests, production packaging,
installed launch, and paired performance measurements were not established by the investigation.

Planning validation on 2026-10-04: `pnpm --filter @acorn/arch-tests test` passed all 11 files and
85 tests, including path/link checks over the new documents. It ran on the same unsupported Node
24.11.0, with the engine warning visible. A separate check resolved every focused-test command's
package/file and confirmed the required sections in all 15 tasks. Whitespace checks passed.
These checks validate the handoff documents; they do not satisfy phase 01's implementation baseline.

## Phase 01: implementation baseline (2026-10-05)

Baseline source revision: `9dfd29df7116d44b16f5bd81e4a18b39df0e32c7`, clean worktree before
measurement. Target: Darwin arm64, `aarch64-apple-darwin`; supported cached runtime
`node-v24.21.0-aarch64-apple-darwin`, pnpm 11.0.0. The Node binary is the SHA-256 checked runtime
that desktop staging caches for the root `node-runtime.json` pin. Set `PATH` so this binary is
called `node` before invoking pnpm or any gate; the host default is unsupported Node 24.11.0.

The worktree had no modules. `pnpm install --frozen-lockfile` could not resolve npmjs.org (`ENOTFOUND`),
and `pnpm install --offline --frozen-lockfile` named missing `esbuild@0.25.12` in the store. For this
baseline, modules were copied from a sibling checkout at the **same revision and identical lockfile
SHA-256** (`78076612aee79894d1089d4a581953b17bf2785458ff343d3c977ee48c573c40`). The
workspace-local pnpm state was rebased to this worktree. This is not evidence that a fresh install
succeeds offline. Dependencies, overrides, and lockfile were left unchanged.

### Reproduce the inventory

Run `node docs/future/trim/inventory.mjs --self-test` and then
`node docs/future/trim/inventory.mjs > docs/future/trim/artifacts/phase-01-inventory.json` from the
repository root under supported Node with an installed graph matching the lockfile. The self-test
uses overlapping roots, peer-qualified snapshots, optional and workspace edges, and conflicting
versions. The [raw inventory](./artifacts/phase-01-inventory.json) is the comparison input for phase
15. It contains the complete per-package size rows and SCC members. The script fails on unresolved
locked nodes or relative TS imports; optional installed packages absent on this target are listed.

Lock traversal starts with all 37 importers. `dependencies` and `optionalDependencies` form the
production roots; `devDependencies` form separate development roots. It follows each snapshot's
resolved dependency and optional edges, including peer-qualified keys, and skips local `link:`
workspace edges. A removable root count subtracts everything reachable from every other production
**or development** root. These are lock snapshot counts, never installed copies or byte savings.

| Measure | Implementation baseline | Definition |
| --- | ---: | --- |
| Manifests / workspace manifests / plugin manifests | 37 / 36 / 21 | Read each locked importer's package manifest; root included only in the first count. |
| Direct external declarations / unique names | 392 / 79 | Manifests declare 205 production and 187 development dependencies: 61 production names, 22 development names, and 18 development-only names. |
| Locked package entries / snapshots / names | 566 / 566 / 528 | Version and peer-qualified snapshots; optional targets included. |
| Production closure | 285 snapshots / 283 names | Reachable from production roots. |
| Development closure / overlap / development-only | 310 / 29 / 281 snapshots | Development reachability, intersection with production, then subtraction. Development-only snapshots contain 247 names; 245 names are absent from production. |
| Installed desktop runtime graph | 112 copies / 111 names / 343,706,024 B | 327.78 MiB of actual package files on Darwin arm64, before staging. Real paths deduplicated; each package excludes its nested `node_modules`. |
| Staged helper package graph | 113 copies / 111 names / 343,726,775 B | 327.80 MiB in `apps/desktop/dist/helper/node_modules`; staging creates two nested copies of `content-type@2.0.0`. |
| Claude adapter installed branch | 103 copies / 256,702,359 B | A subset of the installed runtime graph, so its bytes cannot be added to the total. |
| Production files / lines | 2,276 / 262,013 | TS, TSX, Rust, CSS, MJS under apps/packages/plugins/tools. |
| Production TS/TSX files / lines | 2,172 / 245,143 | Same exclusions; 1,140 test files counted separately. |

The source scan excludes hidden directories, `node_modules`, `dist`, `build`, `target`, `generated`,
`__generated__`, `migrations`, `testkit`, `vendor`, `vendored`, `.turbo`, declarations, and test/spec
files. Lines count newline-terminated lines. The installed branch follows the same peer and optional
manifest edges as desktop staging and records missing target optionals. Source size and historical
figures differ because the audit revision and exclusion implementation differ; do not compare those
figures as a before/after reduction. The lock's production importers also resolve the optional
`@types/node` peer of `packages/plugin-types/package.json`, giving 62 locked production root names
versus 61 manifest dependency names. Snapshot intersection shares 29 names; comparing closure
names independent of versions shares 31. The raw inventory retains both definitions.

Manual shared-root checks: removing the direct `seroval` or `seroval-plugins` root removes **zero**
locked snapshots while all other roots remain. The direct `@modelcontextprotocol/sdk` root also
removes zero; Claude ACP reaches it. The Claude ACP root has 11 uniquely reachable snapshots, but
its 103 installed copies overlap other runtime branches. The installed Claude branch is 244.81 MiB,
including the optional Darwin arm64 binary package. The `node-pty` branch occupies 64,760,054 B,
including 64,363,742 B in the package itself. Its
`prebuilds/win32-arm64` and `prebuilds/win32-x64` directories contain 29,341,768 and 31,092,288 B
respectively on this macOS checkout. These are characterization figures, not proposed omissions.

The TS measurement resolves relative imports and re-exports through each package's tsconfig via
TypeScript's module resolver. Bare package and built-in imports are excluded from these internal
graphs. Type-only and dynamic edges are counted separately; dynamic edges do
not enter the static SCC graph. Both areas have zero unresolved relative imports. Workflow server:
64 files, 128 static value edges, 102 type-only edges, no dynamic edge, one six-file SCC around
`definitions/files.ts`, `definitions/resolution.ts`, `steps/builtins.ts`, and three `processing/`
modules. Agent client: 93 files, 193 static value edges, 60 type-only edges, 11 dynamic imports,
one three-file SCC: `paneContribution.ts`, `sessions/agentPaneModel.ts`, and
`sessions/managedSelection.ts`. The raw inventory names every member and dynamic edge.

### Ownership and preservation map

| Phase / entrypoint | Durable store and mutable owner | Async boundary and consumers | Contract to preserve / existing proof or gap |
| --- | --- | --- | --- |
| 02–05 dependency and packaging roots: manifests, `scripts/nodeRuntimePackages.ts`, `apps/node/externals.ts`, desktop `stage*.mjs`, standalone `pack-node.mjs` | pnpm lock owns dependency resolution; staging owns copied helper files; generated standalone manifest owns install requirements. | Desktop helper/service and standalone Node resolve the external runtime graph after bundles load. | Keep root security overrides, ABI-matched `node-pty`, target optionals, and separate standalone installs. Existing `dependencySecurity.test.ts`, staging tests, build and pack checks; installed release launch remains a later host gate. |
| 06 workflow definitions and processing: `definitions/files.ts`, `steps/builtins.ts`, `definitions/resolution.ts` | Workflow plugin SQLite in `node/schema.ts` stores definitions, revisions, runs, and processing identity. File/processing services own resolution state. | File reads and resolution feed dispatch, incremental processing, and run readers. | Fingerprint bytes, validators, and persisted definition identity. Existing resolution/catalog/processing tests; raw SCC graph above. |
| 06 agent pane selection: `sessions/managedSelection.ts` and `paneContribution.ts` | Device-scoped selection signals in `managedSelection.ts`; Node owns session rows separately. | Pane registration and conversation components read selection after navigation. | `AGENT_PANE_ID`, focus, selected child, per-session Chats only. `managedSelection.test.ts` and `agentPaneModel.test.tsx`. |
| 07 task rail: `packages/client-core/src/features/tabs/TabRail.tsx` | Core tasks/projects in Node SQLite; rail signals own dialog draft, query cache owns fetched rows. | Node-scoped task/project queries, project config bridge, branch/worktree availability, create/patch/archive mutations; desktop and TUI consume the shared rail. | Task/project IDs, branch source, worktree path, setup choice, task order. `TabRail.test.tsx` covers conflicts, fail-open lookup, setup, drag and lineage. **Gap:** held availability across project/Node switch or dialog reopen has no explicit test. |
| 08 agent composer: `plugins/agents/src/client/composer/AgentComposer.tsx` | Session events/attachments in agents plugin SQLite and blob store; `composerDraftState(sessionId,nodeId)` owns shared unsent draft; view signals own picker state. | Upload, replacement, context capture, and durable turn acceptance through Node routes; multiple desktop/TUI surfaces share a draft. | Draft storage keys, attachment IDs, revision acknowledgment, limits and focus. Ownership/state/attachment tests cover held send, picker, replacement, hydration, and CAS. **Gap:** held automatic context capture across a Node/session switch lacks explicit component proof. |
| 09 workflow plugin activation: `plugins/workflows/src/node/index.ts` | Workflow plugin DB and runner/schedule/processing services; activation owns registration/disposal handles. | Host `init`/`ready`, capability calls into agents and GitHub, routes/events/schedules, reconciliation before start; Node and clients consume run state. | Capability IDs, route IDs, workflow run/step IDs and ready ordering. Node integration `workflowRunner`, `workflowTasks`, `workflowFiles` tests plus plugin host tests. |
| 10 plugin host: `packages/node-core/src/server/pluginHost/host.ts` | Host owns per-plugin DB handles, contribution cleanup, roster and reload transaction; plugins own their own DB data. | Ordered init, all-init-before-ready barrier, loaded candidate reload, reverse disposal; Node routes/registries and loaded bundles consume bindings. | Manifest permission gates, API major 3, same capability graph, failed-reload old instance. `host.test.ts`, schedules and Node runtime-contribution integration cover major paths. **Gap:** partial multi-contribution registration failure rollback lacks a direct focused assertion. |
| 11–13 agent runtime: `plugins/agents/src/server/sessions/runtime.ts` and `runtimeEngine.ts` | Agents plugin `AgentStore` persists sessions, turns, events and requests. Runtime/engine own live generations, queue scan, timers, callbacks, and exposed stores. | Durable enqueue precedes provider startup; pump rereads heads after awaits; drivers callback into event buffer; routes, delegation and workflow capabilities consume runtime. | Session/turn IDs, event order, admission fairness, startup reservations, retry, stop joins and public methods. `runtimeQueue`, `runtimeStartup`, `runtimeIdleStop`, `runtime`, session-control/execute and driver tests cover the named races. |
| 14 provider coupling: core `db/schema.ts`, protocol `transport/api/projects.ts` | Core SQLite owns project GitHub identity, task pull relations and generic external-item links; GitHub mirror is disposable plugin data. | Core routes expose fields to rail/task context, Changes, workflow and agent PR linking. | Project/task wire fields and DB history. Core project/task tests and protocol/architecture checks establish current behavior; phase 14 must map each reader/writer before any migration decision. |

The three named gaps are specific characterization work for their owning later phases. Phase 01
changes no behavior, schema, public export, route, or persisted identifier. The existing fixtures
already cover the admission and process lifetime races, so no redundant tests were added.

### Baseline gates and artifacts

All commands ran from this root with `PATH=/private/tmp/acorn-trim-node-bin:$PATH`, where `node` is
a symlink to the cached 24.21.0 binary. `TURBO_FORCE=true` bypasses shared results made on
unsupported Node 24.11.0. Recreate the symlink under a temporary path or use an installed supported
Node before rerunning. The full test required permission to bind local loopback listeners.

| Command after the PATH prefix | Result | Retained log |
| --- | --- | --- |
| `TURBO_FORCE=true pnpm lint` | Passed, 37/37 tasks, zero cached; 3m11s. | [Lint log](./artifacts/phase-01-lint.log.gz) |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test` | Passed, 36/36 tasks, zero cached; 3m44s. Includes architecture, desktop boot, and 62 Rust unit tests. | [Test log](./artifacts/phase-01-test.log.gz) |
| `TURBO_FORCE=true pnpm build` | Passed, 6/6 tasks, zero cached; 19s. Staging used pinned Node from cache. | [Build log](./artifacts/phase-01-build.log.gz) |
| `TURBO_FORCE=true pnpm pack:node` | Passed; service, CLI, and TUI runtime imports checked, nine migration chains staged. | [Pack log](./artifacts/phase-01-pack.log.gz) |
| `pnpm --filter @acorn/arch-tests test` | Passed after the handoff edits, 12 files and 86 tests. | [Final architecture log](./artifacts/phase-01-arch-final.log.gz) |

The inventory graph fixture, `node --check docs/future/trim/inventory.mjs`, scoped oxlint, and
`git diff --check` also passed. The inventory imports the runtime-root list directly and retains
static edge pairs so phase 06 can inspect the same graph without rediscovering resolution rules.

The first full test attempt in the sandbox was stopped after a direct Node startup confirmed
`listen EPERM` on `127.0.0.1`. With loopback permission and the default six package jobs, the
second full run failed one architecture test at its five-second timeout and one client-core
telemetry assertion. Both passed focused reruns:

```sh
pnpm test:focus @acorn/arch-tests boundaries.test.ts -t "shared runtime code does not execute a named plugin route"
pnpm test:focus @acorn/client-core src/host/frames/sdk.test.ts -t "ends a hand-held span once"
```

The third full run passed with two package jobs and two Vitest workers. The [failed concurrent
run](./artifacts/phase-01-test-concurrent-failed.log.gz), [focused architecture
run](./artifacts/phase-01-arch-focus.log.gz), and [focused client run](./artifacts/phase-01-sdk-focus.log.gz)
retain the diagnosis. No code change suppressed either failure.

The staged helper package inventory contains 113 copies and 343,726,775 uncompressed bytes.
Its helper JS bundle is 286,956 B. The staged Node binary is 122,129,232 B, SHA-256
`e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b`.
The generated standalone `acorn-node-1.0.0.tar.gz` under `apps/node/release/` is 2,096,529 compressed bytes,
SHA-256 `df6db6b6f346b216c6444aa45fd0a79e91cef717a9141a4c51ca470c5bb7f861`.
It has 576 archive paths. Its manifest retains the supported Node engine, root security overrides,
and runtime dependencies. The tarball contains bundles and migration chains; operators install its
dependencies separately. Its compressed bytes are therefore a different measure from helper package
bytes. Retain its digest as baseline evidence rather than committing the generated archive.

Measure artifact files with `stat -f "%N %z bytes"`, `shasum -a 256`, and
`tar -tzf apps/node/release/acorn-node-1.0.0.tar.gz`. Inspect the manifest with
`tar -xOzf apps/node/release/acorn-node-1.0.0.tar.gz acorn-node/package.json`. Archive timestamps
can change the digest on a rerun. Build and pack do not prove an installed release launches.

Target gates live in `.github/workflows/ci.yml` and `.github/workflows/build-desktop.yml`: Linux CI,
macOS arm64, and Windows x64 desktop bundles. This baseline covers local Darwin arm64 only.
Phase 02 is next. Reuse the inventory definitions for later comparisons, and add characterization
proof for the named gaps before changing their owners.

## Phase 02: unused direct dependencies (2026-10-06)

Started at accepted revision `8ee46e017` on Darwin arm64, Node 24.21.0, and pnpm 11.0.0.
Search command: `rg -n 'query-async-storage-persister|solid-query-persist-client|seroval-plugins|seroval' apps packages plugins scripts tools package.json pnpm-workspace.yaml`.
It found only five candidate manifest declarations. The source search also covered package exports,
tests, build configs, generated-manifest inputs, and staging scripts. The staged and standalone
consumers were checked separately:

| Declaration | Consumer and resolution finding |
| --- | --- |
| `@tanstack/query-async-storage-persister` in client-core and desktop | `queryCacheLifecycle.ts` constructs a custom `Persister` and calls `persistQueryClientRestore` from the retained `@tanstack/query-persist-client-core`. No source or build import uses the async-storage package. |
| `@tanstack/solid-query-persist-client` in desktop | `QueryCacheProvider.tsx` uses `IsRestoringProvider` and `QueryClientProvider` from `@tanstack/solid-query`. No source or build import uses the persist-client adapter. |
| `seroval` and `seroval-plugins` in TUI | No TUI source, config, export, or dynamic import names either package. The TUI build bundles Solid reactive code, and the standalone packer derives external versions from the remaining TUI declarations. Both packages remain reachable transitively through Solid and remove zero lock entries. |

The desktop manifest still owns service runtime versions, and the packer's generated manifest still
declares the custom persister's core package. No runtime code, persisted schema, public export,
security override, Solid patch, or peer policy changed. Pnpm's lockfile-only regeneration initially
refreshed `caniuse-lite`, `electron-to-chromium`, and `node-releases`; restoring those unrelated
versions left a lockfile with only the intended removals. The subsequent frozen install accepted it.

Run `PATH=/private/tmp/acorn-trim-node-bin:$PATH node docs/future/trim/inventory.mjs --self-test`,
then redirect the same command without `--self-test` to the [phase 02 inventory](./artifacts/phase-02-inventory.json).
The inventory uses phase 01's graph and byte definitions. Direct external declarations fell from
392 to 387, unique direct names from 79 to 75, locked package entries and snapshots from 566 to 564,
and production closure snapshots from 285 to 283. The development closure stayed at 310 snapshots.
Installed desktop runtime copies and bytes stayed at 112 and 343,706,024 B; staged helper copies and
bytes stayed at 113 and 343,726,775 B. The two TanStack packages account for both removed lock
entries; the two seroval names remain in the transitive graph. No unrelated locked version changed.

All commands below used `PATH=/private/tmp/acorn-trim-node-bin:$PATH`. `TURBO_FORCE=true` bypassed
shared Turbo results made under unsupported Node 24.11.0. The package suites and standalone TUI
smoke used loopback permission. Logs are compressed under [artifacts](./artifacts/).

| Command after the PATH prefix | Result | Retained log |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Passed; first install reused 426 packages without downloads, final check reported already up to date. | [Final frozen install](./artifacts/phase-02-frozen-install.log.gz) |
| `pnpm test:focus @acorn/client-core src/infra/persistence/queryCacheLifecycle.test.ts` | Passed, 14 tests; restore, expiry, and write ordering. | Focused output checked in session. |
| `pnpm test:focus @acorn/client-core src/infra/node/fleet.test.ts` | Passed, 21 tests; partition switching and replacement. | Focused output checked in session. |
| `TURBO_FORCE=true pnpm lint` | Passed, 37/37 tasks, zero cached. | [Lint](./artifacts/phase-02-lint.log.gz) |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test --filter=@acorn/client-core --filter=@acorn/tui --filter=@acorn/desktop` | Passed, 3/3 tasks, zero cached: client-core 314 files and 2,400 tests; TUI 68 files and 673 tests with two skipped; desktop 28 shell files and 163 tests, 10 boot tests, and 62 Rust tests. | [Consumer suites](./artifacts/phase-02-consumers.log.gz) |
| `VITEST_MAX_WORKERS=2 pnpm --filter @acorn/arch-tests test --maxWorkers=2` | Passed after final doc edits, 12 files and 86 tests. | [Architecture](./artifacts/phase-02-arch.log.gz) |
| `TURBO_FORCE=true pnpm build` | Passed, 6/6 tasks, zero cached; includes Node, CLI, TUI, and desktop. | [Build](./artifacts/phase-02-build.log.gz) |
| `TURBO_FORCE=true pnpm pack:node` | Passed; nine migration chains, all artifact runtime imports declared. | [Pack](./artifacts/phase-02-pack.log.gz) |

An earlier unrestricted architecture rerun hit three worker timeouts and found a doc path to the
generated tarball, which is removed after inspection. Changing the citation to the release directory
and bounding workers produced the passing final run. The local tarball produced under
`apps/node/release/` was 2,096,648 B, SHA-256
`cf0b81697ceed72f70dcea1e6d035fc752e211e0ca7b70e3fae27114c24e428b`. Its generated
manifest has 27 runtime dependencies, including `@tanstack/query-persist-client-core`, and retains
the Node engine range, root security overrides, keymap pin, and Solid peer override. It excludes
the four removed package names. This archive digest is local evidence; archive timestamps can change it.

For independent installation, the tarball was extracted to `/private/tmp/acorn-phase-02-standalone/acorn-node`.
There, `PATH=/private/tmp/acorn-trim-node-bin:$PATH npm install --omit=dev --no-audit --no-fund`
passed with 195 packages added. `node bin/acorn.mjs --help` exited zero. With
`ACORN_DATA_DIR=/private/tmp/acorn-phase-02-standalone/data` and `TERM=xterm-256color`,
`node bin/acorn.mjs` drew the setup screen, restored the cache, and started its supervised Node at a
loopback URL; Ctrl-C exited zero. The first sandboxed TUI attempt hit `listen EPERM` at 127.0.0.1;
the permitted rerun passed. No workspace `node_modules` was needed by the extracted tarball.

The supported-runtime lockfile SHA-256 is
`83bbf1f7c3927a7db252a15e571c5fc66111d77e69a7e3d07693c8e49f29c8b4`.
Phase 03 is next; it should start from this dependency graph and keep the package-resolution policy.

## Phase 03: target native files (2026-10-06)

Started from accepted phase 02 revision `fa5b0f9a1` on Darwin arm64, Node 24.21.0, pnpm 11.0.0,
and node-pty 1.1.0. The installed package's `lib/utils.js` searches `build/Release`, `build/Debug`,
then `prebuilds/<platform>-<arch>`. `lib/unixTerminal.js` loads `pty.node` and `spawn-helper`.
Windows loads `conpty.node` or `pty.node` and uses ConPTY and winpty DLL and executable assets.
The installed 1.1.0 package has Darwin arm64/x64 and Windows arm64/x64 prebuild directories, but
no Linux prebuild. Its install script builds Linux locally when no prebuild is present. The policy
retains complete selected directories and rejects missing assets, unknown layouts, and unqualified
local builds for a different target. The package graph, version, optional edges, and lockfile did not
change.

Run `PATH=/private/tmp/acorn-trim-node-bin:$PATH node docs/future/trim/inventory.mjs` to reproduce
the [phase 03 inventory](./artifacts/phase-03-inventory.json). It reports 112 installed copies at
343,706,024 B, unchanged from phase 02. The staged helper has 113 copies at 283,230,607 B, down
60,496,168 B from phase 02's 343,726,775 B. Staged node-pty fell from 64,363,742 B to 3,867,574 B.
These are uncompressed package-file bytes and do not predict DMG or installer compression.

All commands below used `PATH=/private/tmp/acorn-trim-node-bin:$PATH`. `TURBO_FORCE=true` bypassed
cache results from unsupported Node 24.11.0. The package suites needed loopback permission; the
first sandboxed run failed at `listen EPERM 127.0.0.1`, and its permitted rerun passed.

| Command after the PATH prefix | Result | Retained log |
| --- | --- | --- |
| `pnpm test:focus @acorn/desktop scripts/stage-runtime-dependencies.test.mjs` | Passed 11 tests, including five target fixtures, source-build handling, and graph behavior. | Focused output checked in session. |
| `TURBO_FORCE=true pnpm lint` | Passed, 37/37 tasks, zero cached. | [Lint](./artifacts/phase-03-lint.log.gz) |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test --filter=@acorn/desktop --filter=@acorn/node --filter=@acorn/plugin-terminal` | Passed, 3/3 tasks, zero cached. Desktop: 169 shell, 10 boot, 62 Rust tests. Node: 272 tests. Terminal: 194 tests. | [Consumer suites](./artifacts/phase-03-consumers.log.gz) |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test --filter=@acorn/desktop` | Passed again after the source-build policy check, one task, zero cached. | [Final desktop suite](./artifacts/phase-03-desktop-final.log.gz) |
| `VITEST_MAX_WORKERS=2 pnpm --filter @acorn/arch-tests test --maxWorkers=2` | Passed after final evidence edit; 12 files, 86 tests. | [Architecture](./artifacts/phase-03-arch.log.gz) |
| `TURBO_FORCE=true pnpm --filter @acorn/desktop build` | Passed staging, renderer budget, and syntax checks; startup scripts 756,895 B. | [Build](./artifacts/phase-03-build.log.gz) |

The outside-checkout smoke copied `apps/desktop/dist/helper` to a temporary directory under
`/private/tmp` and launched a shell with `apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin`.
The installed helper resolved node-pty without checkout links, read `PHASE03_PTY_OK`, resized from
80×24 to 100×30, and exited with code zero. Fixtures cover all five supported triples and check
licenses, selected native files, executable modes, rejected layouts, hoisting, and nested versions.
They do not execute Windows ConPTY or Linux addons. Those target runtime checks remain for the
appropriate release runners; this Darwin-only run is not cross-platform runtime acceptance.

Phase 04 should measure against the phase 03 staged inventory and leave this target policy intact.

Review correction, October 6, 2026: the cross-target host-build fixture no longer assumes a Darwin
arm64 host. It selects a supported triple with a different platform or architecture from the test
host and writes that triple's native prebuild assets. This changes test setup only. Under Node
24.21.0 and pnpm 11.0.0, `pnpm test:focus @acorn/desktop
scripts/stage-runtime-dependencies.test.mjs` passed all 11 tests. The original package suites,
build, and byte measurements remain the phase 03 results above.

## Phase 04: bundled Claude payload (2026-10-06)

**Decision: retain.** Started at accepted revision `52872dafc` on Darwin arm64 with Node 24.21.0
and pnpm 11.0.0. The frozen lockfile installs `@agentclientprotocol/claude-agent-acp` 0.54.1,
`@anthropic-ai/claude-agent-sdk` 0.3.197, and the Darwin arm64 optional binary package at 0.3.197.
The local host CLI reports Claude Code 2.1.289. The frozen install passed after package-cache access
was permitted. An offline attempt lacked `resolve-pkg-maps@1.0.0` in the worktree's store; a sandboxed
online attempt could not resolve npmjs.org. Neither attempt changed the lockfile.

The first-party source path is `plugins/agents/src/server/drivers/claudeHarness.ts` →
`AcpDriver.launch()` in `plugins/agents/src/server/drivers/acpDriver.ts` → `startAcpSession()` in
`plugins/agents/src/server/drivers/acpSession.ts`.
The harness keeps persisted `claude` and `claude-code` IDs, declares `claude` required, and resolves
the adapter with `createRequire`. `launch()` checks the CLI on the service's `PATH`, returns a
diagnostic when missing, and places the resolved path in `CLAUDE_CODE_EXECUTABLE` only when found.
`start()` refuses a launch with diagnostics before spawning. The ACP child receives that override
through the broker environment. The auth probe runs the same resolved host executable directly for
`auth status --json`; it does not import the adapter. Each managed start, including a stored session
reference, runs this resolution again. The session code sends `session/new`, `session/load`, or
`session/resume` after ACP initialization, and passes Claude's stable session metadata on create and
resume. Interactive, workflow, and delegated managed sessions enter the same runtime engine and
driver; the workflow `agents.sessionExecute` capability and delegation service create their own
session kinds and turns. The standalone workflow profile and terminal handoff run the host `claude`
CLI through profile argv, outside this adapter. A contributed harness resolves its adapter inside
its installed plugin package directory, then uses the same generic driver and its declared
`requires` command; that seam does not imply every contributed adapter is the Claude SDK. The npm
standalone manifest and optional dependency graph remain untouched.

The installed adapter's `dist/acp-agent.js` returns `CLAUDE_CODE_EXECUTABLE` first in
`claudeCliPath()`; its other branch resolves the SDK's platform optional binary. Its session query
sets `pathToClaudeCodeExecutable` from that variable or `claudeCliPath()`. Logout and the `--cli`
passthrough also call `claudeCliPath()`. The adapter's `dist/index.js` imports SDK settings before
starting ACP and applies managed-policy `effective.env` to `process.env`. Its assignments can replace
or clear Acorn's `CLAUDE_CODE_EXECUTABLE` after Acorn has validated the host CLI. An empty override
selects `claudeCliPath()`'s bundled-binary branch, so removal would change this supported policy
path. The SDK's installed `sdk.mjs` resolves a platform binary when
`pathToClaudeCodeExecutable` is absent; when supplied, its query transport spawns that path. The
adapter also imports SDK session inspection and deletion functions. This source trace does not
replace isolated real SDK runtime
proof of every supported path. The adapter declares Apache-2.0; the SDK declares its license in
its README. Retention changes no license or distribution contents.

The optional Darwin arm64 package contains 227,252,056 B of files, including a 227,251,472 B
`claude` binary, in this install. Those bytes are an upper bound on prospective uncompressed staging
savings, not a delivered reduction or compressed artifact estimate. The accepted phase 03 staged
helper remains 283,230,607 B; phase 04 changed no staging inputs, so realized savings are **0 B**.
No unchanged desktop artifact was rebuilt.

The sandboxed `claude auth status --json` probe exited unsuccessfully; the same narrow probe outside
the sandbox reported `loggedIn: true`. Authentication is available on this host. The managed-policy
fallback makes omission unsafe under the present adapter contract, so no isolated closure without
the binary or authenticated staged turn was attempted. Omission would also need validated external
spawn, missing-command and cancellation fixtures, unattended metadata and cleanup, and authenticated
staged resume. No omission policy or simulated fallback was introduced. These are requirements for
a future change after the fallback is resolved, not failures of the retained product path.

Baseline checks used `PATH=/private/tmp/acorn-trim-node-bin:$PATH`:

| Command after the PATH prefix | Result |
| --- | --- |
| `pnpm test:focus @acorn/plugin-agents src/server/drivers/acpDriver.test.ts` | Passed 16 tests. |
| `pnpm test:focus @acorn/plugin-agents src/server/drivers/processOwnership.test.ts` | Passed 15 tests. |
| `pnpm test:focus @acorn/desktop scripts/stage-runtime-dependencies.test.mjs` | Passed 11 tests, including five target fixtures. |
| `VITEST_MAX_WORKERS=2 pnpm --filter @acorn/arch-tests test --maxWorkers=2` | Passed 12 files, 86 tests, including document paths and links. |

Phase 05 may start with the phase 03 dependency graph and stage policy. An SDK or adapter upgrade
requires reviewing executable selection, settings import, managed-policy environment mutation,
session query, logout, and `--cli` before revisiting this retention decision.

## Phase 05: keymap dependency branch (2026-10-06)

**Decision: retain.** Started at accepted revision `e99e535ce` on Darwin arm64 with Node 24.21.0,
pnpm 11.0.0, and lockfile SHA-256 `83bbf1f7c3927a7db252a15e571c5fc66111d77e69a7e3d07693c8e49f29c8b4`.
`packages/client-core/src/host/keys/install.ts` constructs the shared engine through its HTML
adapter. `packages/client-core/src/kit/keys/keymapHost.ts` exposes the typed engine and intent layer
seam to both hosts. `apps/tui/src/keys/install.ts` constructs that engine with the TUI's own
`KeymapHost`, registers the universal parser, enabled fields, and metadata, then adds region keys.
`apps/tui/src/keys/commandLayer.ts` applies Acorn's resolved command bindings at its own priority;
`regions.ts` owns focus, `trap.ts` owns modal Escape, and collection layers own navigation. These
owners preserve one intent table, typing protection, command precedence, and teardown. No keyboard
code, contribution ID, preference, or public contract changed.

The installed 0.5.9 package's `package.json` exports the main, `./addons`, and `./html` entries Acorn
uses, plus OpenTUI-specific entries that Acorn does not use. It declares `@opentui/core` 0.5.9 as a
regular dependency and MIT as its license. Its compiled main and universal addons import only
keymap chunks and the keymap main; HTML imports those public entries. None of those chunks imports
Core. Only the unselected `./opentui` and `./addons/opentui` JavaScript entries value-import Core;
corresponding OpenTUI declarations also reference Core types. The accepted lock snapshot makes
Core's renderer, eight platform optional packages, and other transitives installable regardless of
the selected entry. The phase 03 inventory reports **18 uniquely removable locked snapshots** for
the keymap root after subtracting every other production and development root; the historical
24-entry branch count is not a delivered saving.

The [upstream package manifest](https://github.com/anomalyco/opentui/blob/main/packages/keymap/package.json)
was checked on October 6, 2026, when it identified version 0.5.12, MIT, the same public entry
families, and a required `@opentui/core` dependency. The upstream
[core API](https://opentui.com/docs/keymap/core/) and
[universal addons](https://opentui.com/docs/keymap/addons/) describe the supported engine and
registration API Acorn uses. They document no separate renderer-free distribution. An override that
deletes Core would violate the package manifest, and a custom engine or vendor fork would assume
Acorn's layer, sequence, focus, and cleanup semantics. No supported narrower candidate was
established at reasonable maintenance cost. Revisit only if upstream publishes one or a separate
replacement plan proves desktop and TUI parity and the independent Node installation.

For emitted graph proof, the TUI was built with the accepted lock's modules copied from the phase 04
worktree, whose lockfile hash matched. The Vite build passed, followed by
`node apps/tui/scripts/check-startup-graph.mjs` and
`node apps/tui/scripts/check-runtime-imports.mjs`. Startup reported 160 chunks and 710,371 B of
2,187,158 B built, within its 720,000 B limit. Its external imports include
`@opentui/keymap`, `@opentui/keymap/addons`, and `@opentui/keymap/html`. Parsing every emitted chunk
reported zero `@opentui/core` external edges and zero bundled Core modules; no emitted JavaScript
contained a Core import. The runtime check resolved all 47 external imports. These are emitted
value-graph observations, not an independent installed-artifact test or a claim that Core is absent
from `node_modules`.

| Measure | Phase 05 change | Meaning |
| --- | ---: | --- |
| Direct dependency declarations | 0 | The two host declarations and standalone pin and peer policy remain. Only the TUI manifest explanation changed. |
| Locked snapshots | 0 | The lockfile and its 18 potentially removable keymap-only snapshots remain. |
| Emitted imports and bytes | 0 | No source or dependency changed; the TUI graph above is a retained baseline, not a before/after reduction. |
| Installed package copies and bytes | 0 | Core remains installed through keymap; no installed closure was removed. |

The worktree's first offline frozen install lacked cached `@esbuild-kit/core-utils@3.3.2`; a
sandboxed online attempt could not resolve npmjs.org. A copied identical-lock module tree let the
emitted graph checks run, but pnpm's automatic dependency-status check initially refused a
noninteractive modules purge. The architecture runner invoked directly from those copied modules
passed 11 files and 83 tests when `testFocus.test.ts` was excluded. Its full run passed 85 of 86
tests; the focused-test integration case hit the same pnpm install issue. These were environment
failures during the first attempts, not keyboard regressions.

With `PATH=/private/tmp/acorn-trim-node-bin:$PATH` and `CI=true`, an escalated
`pnpm install --frozen-lockfile` completed with the lockfile up to date and no dependency changes.
Then `VITEST_MAX_WORKERS=2 pnpm --filter @acorn/arch-tests test --maxWorkers=2` passed **12 files and
86 tests** through pnpm on Node 24.21.0 and pnpm 11.0.0. The direct Vite and Node graph-check
commands above also used the supported Node runtime. Since the retained implementation did not
change behavior, focused keyboard tests, desktop build, outside install, and real desktop/TUI
sessions were not repeated. Phase 15 still owns the combined gate.

Phase 06 may proceed with the keymap dependency and keyboard seams unchanged.

## Phase 06: internal import cycles (2026-10-06)

Start revision: `20538e8bf649de17763f9033961cd813a488d0af`, clean worktree. Darwin arm64,
Node 24.21.0 via `PATH=/private/tmp/acorn-trim-node-bin:$PATH`, pnpm 11.0.0. `CI=true pnpm
install --frozen-lockfile` succeeded without lock changes. An offline attempt first reported a
missing cached `source-map@0.6.1` tarball.

The unchanged `node docs/future/trim/inventory.mjs` measured TypeScript-resolved relative static
value imports before and after the extraction. The bounded [graph record](./artifacts/phase-06-import-graph.json)
retains every edge, dynamic edge, unresolved import, and SCC for both areas. There were no unresolved
relative imports in either run.

| Area | Before | After | Removed SCC |
| --- | --- | --- | --- |
| Workflow server | 64 files, 128 value edges, one six-file SCC | 66 files, 130 value edges, no SCC | `definitions/files.ts`, `definitions/resolution.ts`, `processing/incremental.ts`, `processing/reprocess.ts`, `processing/store.ts`, `steps/builtins.ts` |
| Agents client | 93 files, 193 value edges, one three-file SCC | 94 files, 194 value edges, no SCC | `paneContribution.ts`, `sessions/agentPaneModel.ts`, `sessions/managedSelection.ts` |

`definitions/builtinDefinitions.ts` owns the built-in kinds, policies, and pure validators, using
the existing shared `stepIdentity` and validation's graph-aware `precedes` callback. The handler
registry stays in `steps/builtins.ts`. `definitions/fingerprint.ts` owns the same recursive JSON
normalization and SHA-256 digest. Resolution still re-exports it for existing consumers; processing,
dispatch, and schedules import the pure owner directly. Fixed digest assertions cover omitted
undefined object fields and ordered arrays alongside existing key-order proof. Client
`paneIdentity.ts` owns the one pane ID; `paneContribution.ts` re-exports it. Selection signals,
including per-session **Chats only**, remain in `sessions/managedSelection.ts`. The selection test
also checks returning to a session after selecting and clearing another. No route, schema, wire
type, persisted ID, or fingerprint version changed.

All five specified focused files passed: resolution 7, catalog 3, processing store 13, managed
selection 4, and pane model 5 tests. `TURBO_FORCE=true pnpm lint` passed 37 of 37 tasks with no
cache. The specified five-filter `TURBO_FORCE=true VITEST_MAX_WORKERS=2
ACORN_TEST_CONCURRENCY=2 pnpm test` passed workflow 64 files/553 tests, agents 150 files/1,086
tests with one skipped, Node 39 files/272 tests, TUI 68 files/673 tests with two skipped, and
desktop 28 files/171 tests plus boot 10 tests and 62 Rust unit tests. The first sandboxed run
failed loopback and process-table tests with `listen EPERM` and invisible process rows; the same
gate passed with host permissions. After the selection tests, the agents suite passed again
with 1,088 tests and one skipped. `pnpm --filter @acorn/arch-tests exec vitest run
--maxWorkers=2` passed 12 files/86 tests. The existing architecture scanner checks package and
source boundaries but does not form internal value-import SCCs; this phase retains the repeatable
graph and behavioral tests instead of adding a separate file-text rule. The full root suite remains
the phase 15 gate.

Phase 07 can use the new pure definition and pane identity owners without changing their IDs or
selection custody.

## Future implementation record

Add one dated section per later phase containing:

1. Start and accepted implementation revisions; dependency versions and target where relevant.
2. Responsibility or dependency changes, including preserved public and persisted contracts.
3. Exact commands, results, and durable relative paths to supporting logs, inventory scripts,
   artifact manifests, screenshots, or host reports. Index any added Markdown evidence.
4. Before/after metrics using the phase 01 method, including zero savings and retained dependencies.
5. Required gates that failed or were unavailable, the reason, and the effect on the next assignment.
6. The next task and its new code locations. Mark retention decisions explicitly as retention.

Do not store credentials, provider prompts containing private project data, or host-specific secrets.

## Verify before building

Check the current revision, supported runtime, and working tree. Read the numbered task's acceptance
criteria before adding a completion record. A missing verification result is not a passing result.

## Phase 08 composer operations (2026-10-06)

Starting revision `f3176818c`, branch `phase-08-separate-composer-operations`. Runtime Node
24.21.0 and pnpm 11.0.0 on Darwin arm64. This phase changed no package declaration, payload,
route, wire contract, storage key, or plugin API major. Before and after dependency and staged
payload measurements are therefore unchanged under the phase 01 definitions.

`composerState.ts` remains the only mutable draft owner, keyed by Node and session. It still owns
hydration, holds, revisions, acknowledgement, fork-context consumption, and shared operation guards.
`composerOrigin.ts` describes the captured session, Node, draft, and visible-surface check.
`submitOperation.ts` builds and enqueues the submitted input and acknowledges the captured revisions.
`attachmentOperations.ts` owns picker, upload, removal, and replacement, including partial success,
eight-item and 25 MiB limits, compare-and-swap, and durable write before old-row deletion.
`contextOperations.ts` owns manual capture and shared single-flight automatic capture. The composer
keeps its presentation state, focus, session-option control, and Solid effects. A deferred picker
open now checks its captured visible origin and its timer is disposed with the view.

The public component tests passed: `composerOwnership.test.tsx` 6, `AgentComposer.attach.test.tsx`
8, `composerState.test.tsx` 3, and `replaceAttachment.test.ts` 9. The ownership test added a held
automatic capture across session and Node changes: the same-Node result stays with its originating
draft, while a result after a Node switch is discarded. Existing held send, upload, replacement,
hydration, and fork-context proofs remain. `pnpm lint` initially failed because copied module trees
triggered pnpm 11's dependency status install in Turbo children; the direct local Turbo lint command
with `--env-mode=loose` passed 37/37 tasks, and root oxlint emitted only baseline warnings. A
frozen offline install was attempted twice and failed because the pnpm store lacks
`@esbuild-kit/core-utils` and other tarballs; registry DNS was unavailable. The identical-lockfile
phase 07 module trees were copied for the gates, with `pnpm_config_verify_deps_before_run=warn`
preventing the status hook from deleting them. The package lint still type-checked every package.

The first four-filter consumer run failed only sandbox loopback (`listen EPERM`) and process-table
visibility assertions. Re-running with host permissions passed agents 150 files/1,089 tests and
one skipped, Node 39 files/272 tests, TUI 68 files/673 tests and two skipped, desktop 28 files/171
tests plus boot 10 tests and 62 Rust unit tests. Commands used `TURBO_FORCE=true`, two Vitest workers,
and two concurrent package jobs. The full root suite remains phase 15's gate.

`pnpm --filter @acorn/arch-tests exec vitest run --maxWorkers=2` passed 12 files/86 tests
after the evidence anchor was added. Desktop `trim-08` displayed the imported fixture composer,
then navigated from Review changed files to Plan follow-up work and back. The returning composer
and session were present. The inspected screenshot is
[phase-08-desktop-composer.png](./artifacts/phase-08-desktop-composer.png). TUI `trim-08-tui`
displayed the same imported session and composer after task navigation at 120 by 40; its captured
screen is [phase-08-tui-120x40.txt](./artifacts/phase-08-tui-120x40.txt). Both sessions were stopped,
and both drivers reported them as not running afterward. The fixture session is imported and
externally controlled, so both hosts disabled the message field, Attach, Context, and Send. The
host driver cannot perform native file picking, and these runs cannot establish held send, upload,
replacement, or fork-context behavior in the running app. Those races are established by the
public component fixture tests; no live provider turn was claimed. The desktop launcher initially
closed after reporting ready; reopening the same isolated session with `--reuse` allowed the
inspection. The TUI session was also reopened with `--reuse --fixture tui-navigation` to retain its
screen capture, then stopped again.

Phase 09 can use these feature-owned operation modules without changing draft scope or the public
composer props.


### Phase 08 review correction (2026-10-06)

The accepted installation gate uses the unmodified repository settings. After moving all copied
workspace `node_modules` trees aside, a clean Darwin arm64
`PATH=/private/tmp/acorn-trim-node-bin:$PATH CI=true pnpm install --frozen-lockfile`
completed with Node 24.21.0 and pnpm 11.0.0. Pnpm resolved and added 426 packages, reused all 426
from its cache, downloaded none, and completed the `node-pty` install hooks in 3.5 seconds. The run
used host permissions for cache access. Standard `pnpm lint` then passed 37/37 tasks with no cache,
and `pnpm --filter @acorn/arch-tests test` passed 12 files/86 tests. Neither command used a pnpm
status warning override. `git status --short` was empty after installation, and `git diff` showed
no change to `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or root `package.json`. The moved module trees
were removed after successful verification. The earlier copied-tree and missing-tarball account
describes the first sandboxed attempt, not the accepted install gate.

The isolated `trim-08` desktop fixture created an Acorn-managed interactive Claude session in
**Plan follow-up work**, separate from the imported, externally controlled session in **Review
changed files**. Its composer became enabled after startup and attached task context automatically.
WebDriver filled an unsent draft, navigated to the imported session, then returned and found the
same draft and context. It sent "Reply with exactly OK. Isolated phase 08 composer check." The
transcript showed the submitted context and the provider answered "OK." A follow-up draft typed
during the turn remained after completion. Native Computer Use opened the composer's file picker
and selected a 36-byte text file inside the isolated fixture; the draft then showed
`phase08-note.txt` beside the retained text. The retained
[managed desktop screenshot](./artifacts/phase-08-managed-composer-attached.png) shows the sent
context, response, unsent draft, and uploaded attachment.

The isolated `trim-08-tui` fixture created a separate Acorn-managed interactive Claude session in
**Plan follow-up work**. At 120 by 40, the terminal driver pasted an unsent draft, used **Go to**
to visit **Review changed files**, returned, and found the same draft and automatic context. Enter
submitted the draft; the transcript showed task context and the provider answered "OK." A new
draft pasted during the turn remained after completion. The retained
[managed TUI output](./artifacts/phase-08-managed-tui-120x40.txt) shows that state.

The host sends completed quickly, so these live runs do not prove a concurrent edit during the
enqueue await. `composerOwnership.test.tsx` holds that await and proves submitted-revision
acknowledgement through the public composer. The desktop WebDriver cannot operate the native picker;
Computer Use supplied that step. The fixture has no contributor for the `agents:attachment` replace
point, so the host offers no replacement action; the public attachment-slot and compare-and-swap
tests cover replacement. The fixture has one Agent pane per task and no second live Workflows run
view for the managed session; the public component test covers two composer surfaces sharing one
session. Both isolated hosts were stopped, and their drivers then reported the sessions as not
running. No provider prompt included private project data.
