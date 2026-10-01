# Managed agent startup and process ownership

Date: October 1, 2026. Status: pending implementation; unit 10.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–09, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 09](../../../plans/performance/09-agent-node.md).

The original [unit brief](../../../plans/performance/implementation-10-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. This supplements report 09. Start after unit 09 is reviewed.
The Agents plugin owns harness protocol and interactive/usage children; core's bounded buffered
`runProcess` is not the duplex JSON-RPC or PTY owner. Preserve task-scoped environment and MCP
authority, pending provider acceptance and durable recovery semantics.

## Spawn through exit

Create ownership at the actual spawn boundary, before initialization or a ready handle exists.
Both ACP and Codex must clean up initialization failure and held startup, not only session creation
failure. Close/unsubscribe gets a documented bounded opportunity, followed by signaling,
escalation and acknowledged exit. Protocol `closed` and `child.killed` do not mean process exit.
Repeated stop calls share one teardown. Pending RPC timers and ACP parked requests settle once.

Own a real process group or supported platform job at launch. Do not discover or kill by executable
name, scan arbitrary ambient descendants, or use external fixture cleanup as production proof.
Account for the direct parent exiting while a normal group member remains. Read core `proc.ts` for
its existing rationale and scoped environment, but use the appropriate plugin/API seam rather than
a private core import. Confirm installed node-pty group semantics before signaling negative PIDs.
Keep durable Terminal tmux teardown separate from these provider and read-only usage children.

Include JSON-RPC overflow/write-error/exit closure, ACP connection closure, Codex thread unsubscribe,
the Codex usage app-server owner and `capturePty`'s idle/failure paths. `capturePty` currently disposes
its exit observer before scheduling escalation and can resolve before the child exits. Output and
rendering remain bounded by their existing policy, with no provider/private transcript logging.

## Runtime startup and shutdown

Trace `ensureSession` from its first await. The current owner entry and `startPromise` are installed
after core cwd/workspace and store awaits, so concurrent callers or stop during those reads need
explicit ownership too. One session generation owns the complete startup wave. A stop sees and
retires pending starts, timers and late callbacks, and no stopped engine can publish a late handle,
mint new work or touch replacement/closed storage. Preserve legitimate explicit ready-on-return
session creation; queue admission changes remain unit 11.

Return the startup cancellation and platform process-owner proposal before editing. If adding a
start signal or deadline to the driver contract, trace built-in and contributed harnesses through
Node plugin RPC: a native AbortSignal cannot silently become an empty structured-clone object.
Define late handle cleanup and unsupported contributed behavior honestly rather than claiming a
bounded stop from a Promise race alone. No provider execution is needed to validate this work.

The inspected registry distinguishes first-party native driver factories from contributed manifest
launch specs. `AgentDriverRegistry.register` constructs the generic ACP driver locally; the public
`ManifestHarness` carries executable data and optional probe callbacks, not a driver start function.
Trace `harnessRegistry.ts` and the capability delivery before choosing cancellation scope. An
internal start signal may remain entirely within the compiled Agents runtime; do not widen the RPC
contract merely because a manifest harness originates in a plugin worker. Conversely, any actual
cross-worker cancellation path must use an explicit supported representation.

Use actual native disposable executables for rejected/hanging initialize, close, ignored polite
signals and a normal grandchild. Record exact owned PIDs, production stop acknowledgement and zero
survivors without external cleanup. Test pending callbacks/timers, startup dependency races,
concurrent startup, protocol overflow and disposal/reconnect generations. Keep retained before
artifacts distinct from fresh cumulative pre10 sources. Run relevant driver/runtime/usage gates,
owning documentation, types/lint. The coordinator owns final native and whole-repository gates.

## Completion and handoff

Implement only the reproduced issues within this assignment. Return any explicitly requested
compatibility, migration, or custody proposal to the coordinator before changing that contract.
Use current production owners for paired evidence; preserve historical fixtures and label superseded
baselines. Write an implementation record with changed files, exact commands and outcomes, before
and after comparisons, costs, and concrete remaining limitations. Update the owning shipped docs
when behavior changes. Retire all disposable resources before review. Do not start the next unit.

## Verify before building

- Re-read the merged source and applicable engineering instructions; the audit predates the main merge.
- Confirm prior units' contracts and actual callers still match this proposal.
- Resolve the listed owner, capability, data model, migration, and compatibility decisions before editing.
- Verify a single Solid runtime and normal QueryClient provider for browser measurements.
- Capture fresh source/probe hashes and the same supported workload on both sides of the change.
- Preserve canonical content, offline rows, unsent drafts, and independent Node authority.
- Run relevant tests and types, then coordinate cumulative lint, bounded tests, and real UI checks.
