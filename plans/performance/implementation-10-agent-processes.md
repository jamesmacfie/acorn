# Unit 10: managed agent startup and process ownership

Date: October 2, 2026. Implemented from the unit 10 handoff.
Base commit: `39c78f84`. Unit 11 admission and discovery work remains pending.

## Ownership and compatibility

The Node-side Agents plugin owns duplex provider processes and read-only usage children.
The core buffered process broker does not own their protocol or PTY lifetime. Its scoped
environment and process-group rationale remain intact. Session authority still comes from
the task-scoped internal environment and persisted tool ceiling. No wire, database,
capability, or migration contract changes.

The proposal returned before editing was to install a startup generation before the first
asynchronous dependency read and pass an internal AbortSignal to locally constructed drivers.
`AgentDriverRegistry.register` builds ACP drivers from manifest launch data. Neither
`ManifestHarness` nor plugin-worker capability delivery carries a driver start callback.
Cancellation therefore stays inside the compiled Agents runtime and is not structured-cloned
through plugin RPC. Native factories that ignore the signal remain joined until they settle.
A late handle is stopped before shutdown returns. An arbitrary non-cooperative factory cannot
be given a bounded stop by racing its promise.

The platform proposal uses detached Unix pipe children and the session/group created by
node-pty's `forkpty`. The installed node-pty 1.1.0 source calls `forkpty` and then `execvp`
without changing that group. Negative PID signals therefore address the owned group.
Windows retains acknowledged direct-child teardown. Equivalent descendant ownership requires
a native Windows job object and is not claimed. Deliberately detached Unix descendants are
also outside this group. No executable-name searches or ambient descendant scans are used.
Durable Terminal tmux sessions retain their separate owner.

## Changes

`server/processes/ownedProcess.ts` owns exit observation at spawn and shares one retirement
promise across stop calls. Protocol close gets 1,000 ms, polite signals get 2,000 ms, and
SIGKILL gets a further 2,000 ms for acknowledgement. Parent exit does not cancel escalation
while the group still exists. Failed acknowledgement rejects teardown rather than reporting
success. The internal cancellation module owns startup deadlines and abortable dependency waits.
An inaccessible group remains present for acknowledgement polling; permission denial never counts
as exit. Errors preserve their original cause. A retained retirement failure blocks replacement
startup, so another caller cannot discard the owner of a process whose exit was not acknowledged.

ACP discovery stays in `acpDriver.ts`. `acpSession.ts` loads on session start and owns the
connection, parked requests, initialization, and handle. Initialization rejection, cancellation,
stream closure, and held session close retire the same process owner. This split also keeps
session-only protocol code outside the service's static boot graph.

Codex startup owns its JSON-RPC child before initialize. Unsubscribe has the same bounded
opportunity as ACP close. JSON-RPC overflow, write errors, stream closure, and child exit reject
pending requests, clear timers, notify once, and retire the group. Both drivers have a 60-second
startup deadline. Retired callbacks cannot publish provider events.

`runtimeEngine.ts` installs the complete startup wave before cwd, workspace, history, and MCP
reads. Concurrent callers join it. Stop aborts dependencies, joins startup and in-flight provider
callbacks, cancels timers, and prevents late handles and replacement-generation callbacks.
Dispatcher and idle preference reads cancel during shutdown. Quiet and idle sweeps that already
started join the shutdown drain. Canonical buffered events still flush before storage closes.
MCP resolution also checks the local generation signal between row reads and secret reveals, so
a held reveal cannot resume by reading another server after storage has closed.

`runtime.ts` retires the engine immediately while title generation drains, shares repeated stop
calls, and joins reservations and session initialization. Saved defaults and requested startup
settings carry their generation's cancellation signal. Explicit creation preserves readiness on
return, including settings application.

Read-only Codex usage uses the same spawn owner. PTY capture retains its exit observer through
signaling and escalation, then resolves or rejects after retirement. Idle, timeout, output-limit,
and write-failure paths share cleanup. Capture and rendering budgets remain unchanged. No provider
or private transcript content is logged.

The shipped contract is documented in [managed agents](../../docs/managed-agents.md).
The unit 10 handoff is deleted, and the performance index advances to unit 11.

## Evidence

The fresh cumulative baseline uses the unchanged historical process fixture and probe.
[Source hashes](./evidence/unit10-pre-source.json) bind it to the pre10 sources. Historical
before-v2/v3/v4 artifacts are retained separately. The replay updates assertions to require
retirement and removes external SIGKILL cleanup. It does not alter the historical probe.

| Workload | Fresh pre10 | Production after |
| --- | --- | --- |
| JSON-RPC stop, parent and grandchild ignoring polite signals | Returned in 0.195 ms with both alive | Acknowledged both absent after about 2 seconds |
| ACP close | Still pending at 150 ms, both alive; external cleanup needed | Both absent when stop returns |
| Rejected ACP initialize | Parent and grandchild alive after rejection | Both absent after rejection |
| Rejected Codex initialize | Parent and grandchild alive after rejection | Both absent after rejection |
| PTY idle capture | Parent absent, grandchild alive | Both absent when capture resolves |
| Same five paired cases | 10 external SIGKILL attempts | Zero external cleanup attempts and zero survivors |

See [fresh pre10 results](./09-process-pre10.json),
[matched production replay](./evidence/unit10-process-after.json), and
[native lifecycle evidence](./evidence/unit10-native-after.json).
The expanded native fixture waits for its grandchild to install signal handlers and report
readiness before answering initialize. This corrects an early fixture race and is distinct from
the unchanged matched workload. It covers held initialize/close, direct-parent-first exit,
protocol overflow/closure, ACP stream closure, usage app-server teardown, and PTY failures.
Every result records exact owned PIDs and absence after production acknowledgement. No external
fixture cleanup establishes success.
The native gate covers 15 scenarios. Fixture readiness allows 10 seconds under suite load; PTY
failure cases use a 5-second test timeout budget. Production capture budgets are unchanged.
The [final PID check](./evidence/unit10-final-pid-check.json) confirms all 40 exact PIDs from the
final native gate and matched replay are absent, with zero external cleanup attempts.

The startup concurrency regression is replayed against the pre10 `runtimeEngine.ts` in a
separate temporary source tree, with no application-source replacement. It fails because the
first dependency is called twice. See [before failure](./evidence/unit10-startup-before.log) and
[production startup gates](./evidence/unit10-startup-after.log). Production races cover cwd,
workspace, history, MCP, reservation, defaults, dispatcher preferences, late handles, and callbacks
from stopped/replaced generations.

Two additional regressions failed before their fixes: a failed PTY prompt write recreated an idle
timer ([before](./evidence/unit10-pty-write-before.log)), and a held MCP secret reveal read closed
storage after cancellation ([before](./evidence/unit10-mcp-before.log)). The existing Codex request
tests also caught a callback timing regression during implementation; synchronous request-event
delivery is preserved. The final source and gate hashes are in
[unit10-after-source.json](./evidence/unit10-after-source.json).

## Verification

Commands use `rtk proxy`. The fresh process baseline and matched replay use installed Node
26.8.1. Repository acceptance uses the bundled Node 24.21.0 via `/tmp/acorn-unit10-node24/node`.
`pnpm_config_verify_deps_before_run=false` avoids pnpm's automatic dependency installation.
`--env-mode=loose` passes that setting through Turborepo. Worker and repository concurrency
bounds remain those of `pnpm test`.

- `env ACORN_PERF_TAG=pre10 pnpm --filter @acorn/plugin-agents exec vitest run --config ../../plans/performance/09-probe.config.ts ../../plans/performance/09-process-probe.test.ts`: two baseline tests passed.
- `pnpm --filter @acorn/plugin-agents exec vitest run --config ../../plans/performance/unit10-probe.config.ts`: matched after replay passed.
- `pnpm --filter @acorn/plugin-agents exec vitest run src/server/sessions/runtimeStartup.test.ts src/server/sessions/runtime.test.ts src/server/sessions/runtimeIdleStop.test.ts`: 57 final tests passed, including refusal of replacement startup after retirement failure.
- `pnpm --filter @acorn/plugin-agents test`: 142 files passed; 1,003 tests passed and one skipped.
  See [Agents suite](./evidence/unit10-agents-final.log). The final one-line replacement-start guard
  and its regression were subsequently checked by the 57-test runtime gate above.
- `pnpm --filter @acorn/plugin-agents exec vitest run src/server/drivers/processOwnership.test.ts`:
  all 15 native cases passed. See [native gate](./evidence/unit10-native-final.log).
- `pnpm --filter @acorn/plugin-agents exec vitest run src/server/processes/ownedProcess.test.ts src/server/mcpServerStore.test.ts`:
  six cases passed. See [owner and MCP gates](./evidence/unit10-owner-final.log).
- `pnpm --filter @acorn/node build`: static graph passed at 3,052,487 bytes after ACP session loading moved to startup. A preceding build measured 3,070,117 bytes and failed the unchanged ceiling.
- `pnpm --filter @acorn/desktop stage`: final service graph passed at 3,054,653 bytes against the
  unchanged 3,062,000-byte ceiling. See [final staging](./evidence/unit10-desktop-stage.log).
- `pnpm --filter @acorn/desktop test:boot`: all 10 checks passed on the final staged service,
  including the unchanged 1,500-ms node startup ceiling. See
  [isolated boot replay](./evidence/unit10-desktop-boot-final.log). No renderer implementation changed.
- `pnpm lint --env-mode=loose`: all 37 tasks passed on the final source, including oxlint and every
  package's TypeScript check. See [final lint](./evidence/unit10-lint-final.log).
- `pnpm test --env-mode=loose`: 36 of 37 tasks passed. Agents passed 1,000 tests with one skip;
  architecture, client, Node composition, Node core, and TUI passed. Desktop's six
  `rendererConnection.test.ts` cases fail on the same missing `helper.config.watch` fixture
  documented in the main-merge review. Its boot and Rust stages were therefore not reached.
  See [bounded repository run](./evidence/unit10-test-node24-final.log). This run precedes the
  final nested MCP cancellation guard; its owner is revalidated by the final Agents gate above.
  The final runtime guard is checked by the focused runtime gate above. Rust tests remain unrun
  after the desktop fixture failure; no Rust source changed.

Initial verification issues were the unsupported default Node 24.11.0, pnpm's install check,
sandboxed process-table access, the fixture's readiness race, and testkit placement. Node 26's
whole-suite backup failures reproduce the limitation recorded in the main-merge review. These
runs are not the acceptance result. The bundled-runtime replay is authoritative for this unit.
An early isolated boot check overlapped lint and Agents tests and failed its timing ceiling at
9,540 ms while its other nine checks passed. The uncontended final replay passed.
A native run hit a transient `EPERM` after signaling. No synthetic parent remained; the owner now
polls permission-denied existence checks conservatively and retains error causes. Both persistent
and transient permission cases, the native replay, and the complete Agents replay passed.
Retained logs remove terminal control codes and trailing whitespace; results and metrics are unchanged.

## Costs and limits

Teardown intentionally waits for exit. Ignored signals cost about 2 seconds; a held protocol close
adds about 1 second. The acknowledgement ceiling is a failure boundary, not proof that every OS
or non-cooperative native factory will exit. Native evidence is synthetic macOS process behavior,
not real provider performance, provider RSS, Windows/Linux native acceptance, or sustained use.

No renderer or terminal UI implementation changes. No paid provider execution, normal-profile
inspection, external messages, canonical truncation, or dirty-draft changes. Unit 11 queue
admission, query work, and provider-discovery optimization remain separate. The broader performance
programme and sustained-use acceptance remain open.
