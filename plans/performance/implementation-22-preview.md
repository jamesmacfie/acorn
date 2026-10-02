# Preview listener and URL resolution implementation

Date: October 2, 2026. Unit 22 is implemented. Native preview acceptance remains blocked by the
service bundle budget. This record replaces the retired unit handoff; it does not establish
sustained-use acceptance for the performance programme.

## Ownership and behavior

Preview URL configuration originates in Node-owned task/project records, terminal run-target
capabilities, and recipe selection. The preview plugin resolves that priority ladder through
`CoreServices`; scripts run through `core.proc.runProcess` in the task root with the established
environment and 10-second deadline. `/v1/p/preview/tasks/:taskId/url` returns the serializable state.
The desktop broker supplies transport and Node authentication. The pane reads from a captured Node,
without a URL query cache, and gives permitted local URLs to the native preview seam. Remote preview
remains unavailable because a tunnel cannot confine child-webview subrequests.

The custody helper owns the dormant tunnel transport. Admission reserves distinct Node/task/port
entries before listening yields. Pending and published entries share the 16-slot limit; matching
opens share one promise. Closing a task or Node retires pending binds and live entries. Pending
retirement rejects the open without publishing a port/secret event. Failed binds release admission.
Every connection, error, idle timer, and WebSocket retains its entry identity. Disposal is permanent.
The existing loopback binding, fresh per-connection pin resolution, constant-time secret check,
header/cookie envelopes, request bounds, full byte delivery, and backpressure remain in their owners.

URL reads share only overlapping task waves. Completed reads are not reused for subsequent reads.
Recipe selection and run-target changes synchronously retire the task's authority. Project changes
retire known matching waves before the active-task lookup; waves still loading task identity have
not consumed project configuration or run-target values. Refresh then joins fresh readers instead of
retiring them again. Retired callers receive `null`, cannot update observations, and cannot emit URL
changes. Identity checks prevent an old finally from deleting a replacement. `tasks:changed`
reconciles active tasks and forgets archived/removed recipe and observation state. Disposal prevents
further script work and suppresses late publication. Running scripts keep their bounded core process
lifetime rather than introducing shared-reader cancellation.

The client helpers accept an optional captured Node while preserving existing calls. Cleanup with
no Node closes nothing. The pane captures Node/task for its resource and cleanup and rejects results
whose owner differs from the selected owner, including same-ID tasks on two Nodes.

## Changed files

- `packages/custody/src/supervision/previewTunnel.ts` and its colocated tests own listener admission,
  connection cleanup, replacement races, and idle retirement.
- `plugins/preview/src/server/previewUrls.ts` and its colocated tests own wave joining, freshness,
  retirement, task reconciliation, and disposal.
- `plugins/preview/src/node/index.ts` subscribes to task changes beside run-target/project changes.
- `packages/client-core/src/infra/node/tunnelUrl.ts` and its colocated tests capture URL policy and
  tunnel cleanup Node authority.
- `plugins/preview/src/client/PreviewTaskPane.tsx` and its colocated tests capture reads and teardown.
- `docs/shell.md` describes shipped lifecycle behavior. The performance index links this record and
  the requested unit handoff is deleted.
- Unit 22 probes, hash manifests, and JSON results below preserve the paired evidence.

## Paired evidence

The fresh before source is commit `bd9b7efbc`; unrelated agents were editing the same worktree.
`unit22-before-hashes.json` records exact production-owner and historical-probe hashes.
`unit22-after-hashes.json` records the implemented owners, tests, and adapted probes.
Historical audit results and probes remain unchanged. The adapted probes assert intended behavior.

| Workload | Fresh before | Implemented | Evidence |
| --- | --- | --- | --- |
| 24 distinct concurrent tunnel keys | 24 listeners, zero refusals | 16 listeners, eight refusals | `13-tunnels-unit22-before.json`, `13-tunnels-unit22-after.json` |
| Close during pending task bind | Listener survives | Open rejects; zero publication | Same tunnel artifacts |
| Dispose during pending bind | Listener survives | Open rejects; zero publication | Same tunnel artifacts |
| Eight matching tunnel opens | One listener | One listener | Same tunnel artifacts |
| Eight overlapping URL readers | Eight process capability calls | One call | `13-preview-unit22-before.json`, `13-preview-unit22-after.json` |
| Refresh completion after dispose | One emitted URL change | Zero events | Same preview artifacts |

The tunnel probe invokes the production owner with actual disposable loopback listeners. All 17
published ports across its cap/join scenarios refuse connections after disposal. No tunnel secret
or private credential appears in the artifacts. URL count probes use a synthetic core process
capability, so they measure work count, not child CPU or UI latency.

`unit22-real-process-after.json` adds a separate actual-core-process check in a disposable directory:
eight readers share one shell; failure and a 10-second deadline produce no URL; all three recorded
shell PIDs are absent after completion. This is supplementary acceptance, not a paired latency
benchmark.

Costs include per-task wave/authority records until task reconciliation or disposal, a task identity
read before run-target resolution, and the original bounded lifetime of retired running scripts.
Project-refresh concurrency is unchanged because no fresh workload justified a concurrency policy.
No CPU, RSS, retained-heap, visible latency, native child-navigation, or day-long stability gain is
claimed by these count and lifecycle checks.

## Verification

Commands use `rtk`. Loopback probes/tests require local socket permission and close their fixtures.

| Command | Outcome |
| --- | --- |
| `rtk proxy env ACORN_PERF_TAG=unit22-before pnpm exec vitest run --config plans/performance/13-node-probe.config.ts plans/performance/13-preview-probe.test.ts` | One baseline probe passes; eight calls and one late event reproduced |
| `rtk proxy node --import tsx plans/performance/13-tunnel-probe.mjs unit22-before` | Baseline reproduced; first sandbox attempt returned `EPERM`, permissioned replay passed |
| `rtk proxy env ACORN_PERF_TAG=unit22-after pnpm exec vitest run --config plans/performance/unit22-probe.config.ts plans/performance/unit22-preview-probe.test.ts` | One probe passes; one call and zero late events |
| `rtk proxy node --import tsx plans/performance/unit22-tunnel-probe.mjs unit22-after` | Intended bounds, retirement, and all published ports closed |
| `rtk proxy pnpm exec vitest run --config plans/performance/unit22-probe.config.ts plans/performance/unit22-process-probe.test.ts` | Actual shell joining, failure, deadline, and recorded PID cleanup pass |
| `rtk proxy pnpm --filter @acorn/plugin-preview test` | Five files, 31 tests pass |
| `rtk proxy pnpm --filter @acorn/custody exec vitest run src/supervision/previewTunnel.test.ts` | 19 tests pass, including existing credential/byte transport tests |
| `rtk proxy pnpm --filter @acorn/client-core exec vitest run src/infra/node/tunnelUrl.test.ts` | Seven tests pass |
| `rtk proxy pnpm --filter @acorn/plugin-preview lint` | Pass |
| `rtk proxy pnpm --filter @acorn/custody lint` | Pass |
| `rtk proxy pnpm --filter @acorn/client-core lint` | Concurrent telemetry test type error in `emitter.test.ts`; no unit 22 error reported |
| `rtk proxy pnpm lint` | Final replay passes all 37 tasks; earlier attempts stopped at concurrent telemetry test type errors |
| `rtk proxy pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts` | Three checks pass on final replay; first run caught a concurrent unit 28 record link before its file existed |
| `rtk proxy pnpm dev:agent -- --session unit22-preview` | Build refuses 3,094,961 B static service graph against 3,062,000 B ceiling; no window starts |
| `rtk proxy pnpm dev:agent:ui -- --session unit22-preview stop` | Confirms the session is not running |

The first actual-process probe invocation used an unexported package subpath and collected no
application evidence. The corrected probe imports the actual owner by repository path from the
root-owned performance harness. An initial preview test type check found a missing fixture
`skipSetup` field; that fixture is corrected. The unrelated telemetry fixture type errors were corrected by their owning agent before the final
repository lint replay; those edits are not included in this commit.

Main-renderer URL/failure transitions require a successful fresh Tauri build. The main-renderer
driver does not control host-owned child-webview navigation, so it cannot establish native retention
or network-policy acceptance. Root bounded tests and final sustained-use acceptance belong to the
cumulative performance validation; this unit runs the focused owner suites.
