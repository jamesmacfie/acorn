# Accumulated performance verification

The original checkout's gates are recorded in [the baseline](./baseline.md). This page records
coordinator gates after implementation. Focused owner results remain in each implementation record.
Passing an intermediate checkpoint does not close later source changes or the final native and
sustained-use gates.

| Checkpoint | Command | Result | Scope and limits |
| --- | --- | --- | --- |
| Units 01 and 02 reviewed | `rtk pnpm lint` | Exit 0; 34 of 34 package checks successful; three cached; 3 min 19.855 sec. | Repository oxlint and package typechecks pass. Oxlint reports warnings, including inherited source warnings and an audit fixture warning. Shared-cache writes report sandbox IO warnings. Unit 03 begins low-risk transport edits during this run; its complete changes require another gate. |
| Unit 03 reviewed | Source-selected transport coordinator replay; see [the implementation record](./implementation-03-transport.md). | Exit 0; [artifact](./evidence/transport-after-unit03-coordinator.json). | Independent terminal restore and sibling survival; sinks 2 → 1 → 0; one shared Docker producer on join; 16 of 16 surviving-viewer frames; zero inactive forwarding; one 144×44 reconnect snapshot; all six captured fixture PIDs absent. Timings overlap focused gates and are not comparative evidence. Final malformed-feature compatibility tests and owner hashes are recorded separately. |
| Unit 04 reviewed | Sequential source-selected cache and preference coordinator replays; see [the implementation record](./implementation-04-cache.md). | Both exit 0; final owner hashes match. | At 100/1,000/3,000 queries: one capture, one write, unchanged final bytes and invalidation state. Device key enumeration zero; only changed slice serializes; equivalent pending values create one timer; removed snapshot stays absent after the window. Focused specialist gates: client 98 tests, TUI 22 tests, architecture 58 tests, three typechecks and targeted lint pass. Comparative CPU belongs to preserved paired samples; native and cumulative gates remain open. |
| Units 01–04 desktop checkpoint | `rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/desktop test` | Exit 0; staging and service budget pass; 20 JavaScript suites with 124 tests; 40 Rust tests. | Fixed JSX barrel poisoning through a narrow component export; four affected suites independently pass 42 tests. Unbounded parallel transforms then exceed the unchanged 1,500 ms boot budget at 2,089 ms; isolated eight-test boot passes. Four-worker bound makes the standard full gate pass without changing the budget. Native behavior and later changes need fresh gates. |

## Units 01–05 checkpoint

The coordinator reviews unit 05's source, exact probe/config hashes and paired rail CPU artifact.
Core 100, Notes 41, terminal 42 and architecture 67 focused tests and five-package lint/types pass.
Final adopted model disposals are 3/3 with zero observers and drawn owners. Superseded split-runtime
and overlapping CPU artifacts remain excluded; Notes recovery durability tradeoffs are documented.

`rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/desktop test` exits zero:
20 JavaScript suites/124 tests and 40 Rust tests. Service is 2,811,689 bytes below unchanged
2,910,000 ceiling; renderer staging transforms 1,187 modules. Full log:
`/tmp/acorn-perf-unit05-desktop.log`. No budget widening or dependency upgrade.

Fresh isolated Tauri `perf-focus-after05` checks pass synthetic Notes creation/body/title saving,
Home-to-task return, plain Shell prompt painting and parked return. Relevant screenshots are
visually inspected. The fixture stops and its four recorded PIDs are absent. Native visibility is
true but native/document focus false and document hidden; exact-PID AppKit activation refuses.
This is functional evidence only, not visible latency, CPU/RSS improvement or sustained-use proof.
See [native notes](./native-validation-notes.md) for evidence and limitations.

Whole-suite `pnpm test`, final `pnpm lint`, final staged desktop checks, disposable TUI composition,
representative mixed-use resource plateaus, and fixture cleanup remain pending.

Local pnpm commands need `--config.verify-deps-before-run=false` until managed dependency metadata
is reconciled. Unit 04 declares the already-installed public persistence core 5.101.0 and links it
locally; its offline install attempt aborts before mutation because pnpm would remove module
directories without a TTY. Do not force a shared dependency purge. The manifest and lock agree.

## Coordinator preparation during unit 06

Review briefs 19–28 are complete. The coordinator records accepted units 01–05 in
[the results summary](./implementation-results.md) and defines the final repeated-use workload in
[the sustained validation plan](./sustained-validation-plan.md). A read-only link check verifies 69
relative targets across six coordinator documents. This checks the documentation, not application
behavior. Unit 06's architecture proposal is accepted; actual SDK/worker ownership and startup
evidence remain under specialist verification. No coordinator fixture, build, or measurement is
running during those comparisons.

Unit 06's lint run stops at an unused `encodeIdFrame` destructuring binding in the unit 03 paired
probe. The coordinator preserves the pre-lint source bytes, removes that binding, and records both
hashes in [the lint change record](./evidence/unit03-paired-probe-unit06-lint-change.json).
The selected module and workload remain the same; no measured result artifact changes. This is
a fixture lint repair, not a fresh transport performance comparison. A passing cumulative lint gate
still remains required.

## Units 01–06 checkpoint

The coordinator reviews the final unit06 source, protocol/SDK compatibility, document-grant
generation, HTTP region leases, startup and termination owners, lasting tests, and owning docs.
The [v3 manifest](./evidence/unit06-final-source-manifest-v3.json) matches 92 current source/test/doc,
probe, SDK bundle, evidence, and referenced immutable-manifest entries. The initial recursive hash
check mistakenly compares a historical v1-to-v2 delta to v3 bytes; that result is preserved and
excluded. [The corrected check](./evidence/unit06-coordinator-hash-check-final.json) separates the
historical delta records from current source claims.

The independent coordinator command is:

```sh
rtk proxy env ACORN_PERF_OWNER=after ACORN_PERF_SDK=modern ACORN_PERF_TAG=coordinator-modern-ports ACORN_PERF_BARRIER=0 ACORN_PERF_DOCUMENTS=both ACORN_PERF_HELD=1 ACORN_PERF_WARM=5 pnpm --config.verify-deps-before-run=false exec vitest run --config plans/performance/unit06-owner.config.ts
```

It passes with one verified Solid runtime, seven ordinary provider constructions/cleanups, one native
permission-scoped worker, seven closed host view endpoints out of nine channels before pool stop,
retired API rejection and held-request abort, document revocation, and surviving Node B/document B
access. [The root replay](./evidence/unit06-owner-coordinator-modern-ports.json) counts host port1
close calls, not both endpoints. Two module endpoints remain warm until final cleanup.

The cumulative desktop command remains:

```sh
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/desktop test
```

It stages the SDK, first-party bundles, service, helper, bridge, and renderer and exits zero:
20 JavaScript suites/124 tests and 40 Rust tests. Service is 2,811,689 bytes below the unchanged
2,910,000-byte ceiling. Full log is `/tmp/acorn-perf-unit06-desktop.log`. Specialist full lint passes
34/34 package tasks; client416/TUI16/HTTP14/database10/architecture67 focused tests pass.

Fresh isolated Tauri `perf-focus-after06` paints the actual HTTP list/detail and a synthetic unsent
URL, verified in an inspected screenshot. Home-to-API returns remain blank while document-hidden,
with two empty remote-tree containers and no recorded errors. A repeated test-only native focus
attempt succeeds with nativeFocused/documentFocused true and visibility visible; both regions render
and the unsaved URL survives in the same running window, without source changes or runtime overrides.
This is consistent with background WebKit worker suspension, not an established remount defect.
The specialist reviews the SDK and HTTP revive owners and makes no speculative repair. A later
three-cycle attempt fails its actual focus prerequisite; no repeated-cycle pass or latency gain is
claimed. [Native notes](./native-validation-notes.md) retain the exact artifacts and remaining gate.
Fixture stop exits zero; launcher/app/helper/Node/Docker PIDs are all absent in
[the cleanup record](./evidence/native-after06-cleanup.json). No app or measurement remains running.

## Units 01–07 checkpoint

The coordinator reviews terminal byte ownership, adjacent operation joining and ordering, captured
boot/database authority, private admission, roster publication, teardown settlement, and actual
attachment versus durable-session cleanup. The final stable session facade also preserves normal
150 ms agent submission while rejecting retired callbacks. The specialist passes 182 terminal
tests, 67 architecture tests, package types, and targeted lint.

Independent checks match all 19 entries in [the source check](./evidence/unit07-coordinator-source-hash-check.json)
and all 34 entries in [the evidence check](./evidence/unit07-coordinator-evidence-hash-check.json).
The [root replay record](./evidence/unit07-coordinator-replay.json) records a passing engine probe
and five focused files with 47 tests. The process tests exercise actual disposable PTYs, a private
tmux socket, and temporary migrated SQLite data. Removal/disposal leaves zero callback handles,
flush timers, and old-boot publications; ordinary tmux retirement preserves durable work.

The cumulative command is:

```sh
rtk proxy pnpm --config.verify-deps-before-run=false lint
```

It exits zero with 34 successful package tasks in 1 minute 4.48 seconds.
[The lint record](./evidence/unit07-coordinator-lint.json) preserves the complete output and hash.
No coordinator test process, fixture app, or build remains running. Final bounded repository tests,
fresh staged native terminal interaction, and sustained-use validation remain pending.

## Units 01–08 commit checkpoint

The user requests a commit after the active diff/highlighting unit on October 1, 2026.
Units 09–28 and sustained-use validation remain pending. The coordinator reviews the optional
exact-body acknowledgement contract, original callback capture, retained-row accessors, gap epochs,
worker settlement, Markdown flight cleanup, and linear collection snapshots. All 60 paths, byte
counts, and hashes match the [final coordinator check](./evidence/unit08-coordinator-hash-check.json).

The bounded repository command is:

```sh
rtk proxy pnpm --config.verify-deps-before-run=false test
```

It passes all 35 package tasks, with six cached, in 2 minutes 44.057 seconds. The TUI runs 48 files,
598 passing tests, and two skipped tests. The desktop gate stages fresh bundle inputs and passes
124 JavaScript and 40 Rust tests. [The complete final log](./evidence/units01-08-full-test-final.json)
retains command output and its hash.

The [first run](./evidence/units01-08-full-test-initial.json) and
[second run](./evidence/units01-08-full-test-replay.json) remain preserved. Two exact contract gates
needed alignment with deliberate additive changes: the plugin API snapshot adds `queryOwner`,
`wsSendToNode`, and testkit `refreshFleet`, with no removed names; pairing keeps exact key/value
assertions and admits only the already-documented `eventTransport: { viewers: 1 }` advertisement.
No application implementation changes for those gates. Architecture, scaffold, preview, and GitHub
load-bound failures pass in the second bounded run. The [isolated full TUI run](./evidence/units01-08-tui-isolated.json)
reproduces cold telemetry timeouts; all six telemetry cases pass alone with one worker in 4.29 seconds.
Bounding internal TUI forks to two then passes the complete repository run without changing test
assertions or deadlines. This changes test scheduling, not application performance.

Final `pnpm lint` exits zero: 34 successful package tasks, one cached, in 2 minutes 18.509 seconds.
[The final lint log](./evidence/units01-08-final-lint.json) retains the complete output and hash.
`git diff --check` passes for tracked edits. The staged check flags only trailing blank lines in
two immutable raw unit07 test logs; those bytes remain intact for their published hashes. The
staged check excluding those two log files passes. No dependency installation, new branch, paid
provider, or normal profile change is needed.

The isolated real Tauri `perf-focus-after08` session confirms native/document focus and visibility,
creates a synthetic task, opens Changes and the terminal drawer, paints a plain Shell prompt, and
closes the Shell. Both screenshots are visually inspected. The project is deliberately non-Git,
so this native check covers the Changes empty state, not loaded diff-row scrolling or composer
latency. Actual row/composer behavior is covered by the selected production-owner tests and jsdom
fixtures. [Native notes](./native-validation-notes.md) record those limits. Shutdown and launcher
both exit zero; all six exact owned PIDs are absent in
[the cleanup record](./evidence/native-after08-cleanup.json). No fixture app remains running.

This checkpoint establishes the tested batch. It does not complete the remaining implementation
units, two-Node composition gate, repeated-use plateau, or day-long stability investigation.
