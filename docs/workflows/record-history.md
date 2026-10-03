# Record processing history

When a workflow processes records in a loop, the workflow database remembers which records it
selected and what happened to each. This page covers that ledger, repeat policies, retry and
reprocess, and incremental checkpoints. `WorkflowProcessingStore` owns it.

## Record processing history

The workflow database owns selections, selected rows, record states, attempts, processing scopes,
and committed source boundaries. `WorkflowProcessingStore` reserves selected snapshots, repeat
decisions, eligible child dispatches, and a checkpoint in one transaction. Core tasks are created
only after that transaction commits. Recovery reuses the reserved task and run IDs.

A root can receive `processingScope: { scopeId, epoch }` through the internal start seam. The scope
is frozen in the same transaction as the root and its steps. Schedule integration uses its schedule
ID and explicit epoch. A manual root without this option receives independent history. Loop paths
use stable step IDs and ancestor item identities, so label edits do not reset history and nested
parents do not share a child-loop state.

Source rows use plugin, source, connection, and record ID as their identity. Retrieval scope and
display titles are excluded. Ordinary arrays require a stable typed key. `repeat` on `workflow-map`
supports `every-match`, `unseen`, and `changed`; the latter requires tracked JSON Pointer `fields`
against the retained item. Source item fields therefore address its envelope, such as `/data/state`.
Canonical projections distinguish missing from null, sort object keys, and preserve array order.
Changed-field decisions compare the last admitted or baselined snapshot, so A to B to A admits both
changes. An unchanged failed attempt is not automatically retried. Active attempts prevent competing
admission within the same record scope.

Changing tracked fields reprojects the retained snapshot. A field that cannot be reconstructed
requires an explicit baseline or fresh epoch. A baseline records identity and projection without
creating children. An explicitly reviewed baseline may replace a changed query's checkpoint
fingerprint, with a compare-and-swap check against the prior boundary. It retains attempt history.
A fresh epoch retains prior history under its original scope.

Retry resumes a failed attempt with its retained snapshot and task/run identities. It does not rerun
the source query. Reprocess prepares an immutable selected row and digest, then sends that digest with
a request identity to `reserveReprocess`. The method derives the original scope, snapshot, child
inputs, and definition from server rows; clients cannot substitute them. It reserves a related
attempt, creates an ordinary workflow child task, and starts the child workflow as an independent root
run. Nested records retain their original business history even though the new run has independent
runtime lineage. Replaying the same command reuses the reservation. Reprocess does not reopen a
settled parent or restart successful siblings.

An incremental `find-records` step feeds exactly one tracked loop through `/records`. Its path to
that consumer must be unconditional; conditions after the consumer are allowed. `take` is refused.
Only a complete execution selection can commit a source-provided boundary. Zero matches and all
skipped matches may advance it. Invalid bindings, limits, or changed active records roll back the
selection and boundary together. Query semantics and the previous boundary are checked at commit.
An expired token or changed query requires an explicit baseline or epoch decision. Cancellation
after commit retains cancelled child intents and the boundary for explicit reprocessing.

Device-only run routes expose filtered, paged selection summaries, chronological attempt history,
and a separate retained-snapshot read. Pages contain at most 100 rows and do not include record bodies
or named outputs. Detail and attempt payloads bound every preview. Skipped rows retain links to their
preceding attempt. The processing ledger does not prune record identity or automatically archive
tasks.

Selection pages compute global category counts and eligible positions from compact decision,
dispatch-state, and run-status fields before loading page details. Only the admitted page reads
record snapshots, dispatch payloads, run errors, and step previews. Step results use a bounded
UTF-8 byte prefix before the JavaScript preview slice, preserving Unicode, embedded NULs, and
structured-versus-plain selection. Snapshot parsing, named outputs, and attempt history read their
complete inputs. A missing run retains the dispatch-state fallback, and an active skipped row
retains its prior attempt's status and retry target.
