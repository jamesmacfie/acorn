# Workflow custody implementation record

Date: October 2, 2026. Unit 25. Implemented on the shared performance branch at the user's request.
Native acceptance remains blocked by the Node service bundle size gate. This record does not close
sustained-use acceptance or authorize the next unit.

## Changes and ownership

- `plugins/workflows/src/client/workflowsClient.ts` captures the QueryClient's registered Node for
  reads and writes, including explicit null. Event-only callers retain their ambient API. Requests
  still use the host API and broker. No transport, grant, schema, or Node write contract changes.
- `editor/draftAddress.ts` captures source, route, project, file target, entity, and generation before
  asynchronous work. `editor/draftStore.ts` rejects late loads, validation, lists, and publication
  results from departed definitions. It flushes captured pending edits on navigation and cleanup.
- `editor/draftCustody.ts` owns submitted content, base revision, recovery, serialization, pending
  save coalescing, and conflicts. The originating owner receives the acknowledgement. Edits after
  submission remain dirty and are rebased into recovery. Reopening an inflight entity joins its
  owner. Concurrent owners serialize delivery by Node and entity without sharing their draft state.
- `editor/WorkflowEditor.tsx`, `FieldControl.tsx`, and `GenerateModal.tsx` bind child creation, field
  choices, validation, backend discovery, and generation to captured APIs. The AI dialog retires
  on definition navigation. The shared `AuthoringConversation` captures its transport and recovery
  Node, aborts on disposal, and rejects cancelled or replaced replies.
- `packages/client-core/src/host/registries/shell/schedules.ts` owns one operation and one dirty
  follow-up per contribution and Node generation. It catches synchronous throws and rejections,
  respects visibility and capability, and preserves independent contributions and scheduler owners.
- `client/refreshQueue.ts`, `runs/runStore.ts`, and `runs/runPaneModel.ts` join matching read waves,
  honor invalidations during follow-ups, and suppress retired results. Commands await a read taken
  after their completion. A status frame arriving during a snapshot survives that snapshot without
  fetching. A departing shared navigation subscriber does not cancel a surviving subscriber.
- Run panes keep stdout and stderr only in their exact 4,000-character combined tail. They retain
  managed-agent and unknown events in the generic 200-event ring. `NodeDetail.tsx` reports overflow.
  Selection retires live events, tails, overflow, and status dictionaries. Returning reads full
  durable results. Unsent gate forms retain the model lifetime. The host keeps one task model per
  pane and retires it with the task or Node shell.

CAS, three-way conflict choices, undo coalescing, recovery keys and acknowledgement checks, file
hashes, review receipts, repository trust, and uncommitted file publication remain in their owners.
Saving never publishes automatically. Device recovery still uses full synchronous JSON copies and
storage-failure fallback. This unit does not optimize storage enumeration or impose draft limits.

## Evidence

`unit25-before-hashes.json` captures the cumulative production and historical probe sources before
editing. The original `14-*-probe.test.tsx` fixtures and historical evidence remain unchanged.
The frozen `evidence/unit25-runPaneModel-before.ts` is the pre-change production model with relative
imports relocated for a paired measurement. After measurements invoke the production model.
`unit25-probe.config.ts` pins the installed Solid ESM entries and Solid Query ESM entry. Both paired
models construct once under a normal QueryClient provider. The corrected after assertions live in
separate unit25 probes.

| Workload | Before | After | Evidence |
| --- | --- | --- | --- |
| Held schedule plus 30 edges | 31 calls and peak 31 | One held call and peak one; one follow-up, then a third pass for an edge during that follow-up | `14-client-schedules-unit25-before.json`, `14-client-schedules-unit25-accepted.json` |
| Save A, load B, release A | B revision changes from five to two and becomes dirty | B remains revision five and clean | `14-authoring-unit25-before.json`, `14-authoring-unit25-accepted.json` |
| Cleanup after Node A becomes B | PUT delivered to B | PUT delivered to A | Same authoring evidence and `unit25-api-custody-after.json` |
| Same definition ID on captured A/B APIs | Historical ambient routing | A reads revision one, B reads five, deferred A write stays on A; registered null is rejected before broker delivery | `unit25-api-custody-after.json` |
| Twelve runs, 200 stdout chunks per run | 4,928,680 unused characters in event rings, 48,000 tail characters | Zero stream characters in event rings; only selected run's exact 4,000-character tail | `14-run-pane-unit25-before.json`, `unit25-stream-unit25-accepted.json` |
| Paired retained heap delta after explicit GC | 1,261,984 bytes | 127,872 bytes | `unit25-stream-unit25-accepted.json` |
| 205 unknown events | 200 retained, first index five, no omission indicator | Same 200 events, with five omissions reported | Same paired stream evidence |

The heap comparison is one Node 24.21.0/jsdom fixture run, with five explicit collections before and
after each sample. It measures actual heap separately from logical string characters. The measured
CPU includes fixture work and GC: before 264,967 user and 1,606 system microseconds; after 260,844
user and 1,330 system microseconds. These figures do not establish native latency or sustained-use
improvement. Earlier unit25-after, unit25-final, and unit25-verified samples remain preserved and are superseded by
unit25-accepted for the final comparison. The initial historical characterization ran under Node
24.11.0; the paired heap, broker, and final verification run under supported Node 24.21.0.

Lasting owner tests exercise late acknowledgements, new edits, pending save coalescing, inflight
return, conflict choices, storage failures and recovery remount, delayed file loads and review, external file conflict choices,
publication/export navigation, explicit null, schedule failure/visibility/capability/disposal,
independent owners, 30 child invalidations, snapshot status races, selected-run retirement,
authoritative command refresh, durable output on return, and preserved gate form edits.

## Verification

Commands use `rtk`. The supported runtime is selected with
`rtk proxy env PATH=/private/tmp/acorn-merge-node24-bin:$PATH`.

- `ACORN_PERF_TAG=unit25-before pnpm exec vitest run --config plans/performance/14-probe.config.ts`:
  three files, four historical characterization tests pass before editing.
- `ACORN_PERF_TAG=unit25-accepted pnpm exec vitest run --config plans/performance/unit25-probe.config.ts`:
  four files, five probes pass. Earlier adapted probe syntax failures were corrected before acceptance.
- `pnpm --filter @acorn/plugin-workflows exec vitest run --maxWorkers=3`:
  65 files, 555 tests pass, including Node file-authoring/publication/recovery contracts.
- `pnpm --filter @acorn/plugin-workflows exec vitest run src/client/editor/draftStore.test.tsx src/client/runs/runPaneModel.test.tsx src/client/runs/runStore.test.ts --maxWorkers=3`:
  three files, 31 final owner tests pass.
- `pnpm --filter @acorn/client-core exec vitest run src/features/dataSources/AuthoringConversation.test.tsx src/host/registries/shell/schedules.test.tsx`:
  two files, 11 tests pass.
- `pnpm lint`: all 37 package tasks pass. Earlier runs encountered incomplete concurrent changes
  in `Rows.test.tsx`; those failures are resolved in the accepted run.
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts`:
  two files, 59 tests pass. Earlier runs encountered a concurrent editor
  process exception and a not-yet-written implementation record; both are resolved before handoff.
- `git diff --check`: passes.

## Native acceptance and limits

`pnpm dev:agent -- --session workflow-custody-unit25` fails before launching the window during
service staging. `pnpm dev:agent -- --session workflow-custody-unit25 --reuse` also fails: static
service graph 3,076,906 bytes, ceiling 3,062,000 bytes. The first attempt measured 3,076,666 bytes.
`unit25-native-staging.txt` preserves the retry. The gate was not raised or bypassed. No native
screenshots or Node-switch acceptance are claimed. The stop command confirms the session is not
running. No providers, external messages, or normal profiles were used.

The isolated synthetic broker proves API target delivery, not native window behavior. Complete
native authoring/save/run-history checks after the shared service staging gate passes. Full-repository
bounded tests and sustained-use acceptance remain with the programme's final validation unit.

Owning shipped docs updated: `docs/workflows.md`, `docs/workflows/authoring.md`,
`docs/workflows/execution.md`, and `docs/schedules.md`. The pending unit markdown is deleted and its
index entry links to this implementation record. The commit includes only unit25 changes and keeps
other agents' staged and unstaged work intact.
