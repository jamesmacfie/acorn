# Unit 25 coordinator review brief

Source review on October 1, 2026. Read area 14, workflow authoring/recovery/publication/execution
docs and reviewed units 04/05/24. Take fresh cumulative source hashes and production owner baseline.
Workflow Node write CAS and recovery contracts remain intact; the API must not follow ambient Node
selection during cleanup or a later asynchronous continuation.

## Authoring custody

createDraftStore captures activeNode only when save runs, including cleanup after the shell switches.
Create a Node-qualified workflow API from the model's QueryClient owner and preserve explicit null.
Trace all definition/file/catalog/provider/validation/publication/copy/remove/rename/layout/recovery
paths, not only updateDef. Loaded resource inputs must capture source, route, fileTarget, project,
entity and generation before await; their fetchers currently reread ref()/fileTarget() afterward.
Late operation lists/publications/validation can also publish into a replacement definition.

Capture submitted definition, base revision/base definition and exact recovery copy. Serialize
per entity and coalesce only superseded pending saves. An acknowledgement updates the originating
base and removes only the exact submitted recovery; edits during a held save stay dirty/recoverable.
A's completion cannot change B's revision, undo history, conflicts or save status. Failed/conflicting
writes retain full draft and existing three-way merge choices. Explicit publication/export waits
for the correct save, targets the captured operation and never publishes a different current entity.
Keep database versus repo/user authoring, trust/review, file hashes, publication receipts, uncommitted
worktree semantics, CAS, undo coalescing and device recovery identity. No automatic publication.

RecoveryStore already validates exact content/revision before removing copies. Preserve that guard,
storage-failure fallback and all unrelated copies. If device serialization/key-enumeration changes
are selected, capture a fresh actual baseline first; no source-only arbitrary cap or draft loss.
Cleanup flushes captured pending edits, then removes listeners/timers/validation/publication work
without writing to the incoming Node or retaining a revoked grant.

## Refresh admission

startClientSchedules runs each timer/event/visibility edge immediately; entry.run synchronous throws
also occur outside Promise.resolve's rejection handling. Own one active operation and one dirty
follow-up flag per contribution/generation. An edge during the follow-up schedules another pass.
Retain visibility/capability predicates, independent contributions, delayed subscribe cleanup,
failure/retry behaviour and registry lifecycle. Shared readers are not canceled by one departure.

RunStore and RunPaneModel must use the captured API and Node/run generations. Join matching refresh
waves without dropping invalidation after a snapshot; commands await an authoritative refresh rather
than treating a pending stale wave as complete. Step-status events remain fetch-free. Disposal and
selection change stop obsolete follow-ups/publication. Ordinary query observers retain independent
lifetime. No added polling, time-based freshness cache or provider execution is required.

## Live stream representation

RunPaneModel stores full stdout/stderr events in the generic200-event ring although NodeDetail
filters those types and uses the separate4,000-character tail. Send them only to the exact tail,
preserving full canonical durable results and event consumers. Trace managed-agent/unknown event
inspection before excluding any other type. Give selected/nonvisible run dictionaries an explicit
retirement/return policy and bounded idle ownership. Unknown-event overflow requires truthful UI
indication and a measured baseline; arbitrary silent event shortening is not selected.

## Evidence

Actual same-ID A/B captured APIs and reused-store held load/save/conflict/publication/disposal;
new edits after submit, failed storage, file source and recovery remount. Schedule held first read+
30edges: peak1 and one dirty follow-up, with another edge during follow-up honored; hidden/capability/
sync-throw/reject/dispose/two-owner cases. Run-pane30childedges with snapshot race and selected-run
change; fetch-free status preserved. Twelve runs×200stdout chunks: no unused4,928,680-character
event copy, exact tails/canonical output/revisit, actual retained-heap comparison separate from CPU.
Run focused owner/authoring/read-model suites/types/lint and docs; coordinate native authoring/save/
run-history transitions with the coordinator using synthetic data and no provider execution.
