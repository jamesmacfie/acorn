# Workflow data and execution

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions and precedents](./context.md). Read [typed data](./data-contract.md) first.

## Definition and value contracts

Version the workflow definition format explicitly. Introduce stable step IDs separate from names.
Edges, bindings, branch targets, layout references, and processing history use those IDs. Renaming
a step changes its label, not its execution identity. Copying a step creates another ID. Repository
files retain IDs across edits; do not regenerate them on each parse or export.

Workflow inputs declare the shared structural schema, label, description, requiredness, and optional
typed default. A definition also declares named outputs bound to completed step values. Child
consumers read these outputs, not an arbitrary last transcript message. A child with no declared
outputs still returns its status and task/run references.

One binding vocabulary addresses a literal, workflow input, predecessor output, or current loop
item. A binding has a field pointer where relevant, an optional typed fallback, and an optional
explicit conversion. Whole objects and arrays are valid values. Resolve against the frozen run and
completed transitive predecessors, never siblings that merely happened to finish first.

Missing uses the fallback when present. Otherwise it is omitted for an optional destination and
fails a required destination. Null is a value and must be allowed by the destination schema.
Conversions initially cover scalar-to-text and explicit JSON-to-text for prompts. Reject partial
numeric parses and inferred conversions. Templates render text at the prompt/title boundary only;
they do not change the underlying typed input. A bound structured prompt value uses bounded,
deterministic JSON serialization, with no hidden truncation.

Keep safe pointer parsing and own-property traversal. Do not evaluate JavaScript, arbitrary template
expressions, or provider-supplied accessors. Validate structural output on the Node before marking a
step complete, even if a model claims its output conforms.

## Step behavior

| User-facing step | Execution behavior |
| --- | --- |
| Find records | Resolve inline or published saved query and its typed arguments; collect and validate a complete selection; persist it as structured output. |
| Get record details | Resolve an exact record reference through its source, validate detail schema, and persist the fetched result with its read time. |
| Run a workflow | Dispatch one child with typed inputs and wait without holding an agent execution slot. |
| For each | Read an array from a predecessor, validate bindings and identity, reserve the complete eligible roster, and dispatch child workflows. |
| If/otherwise | Evaluate a typed comparison or bounded all/any condition over available values; choose one branch without an AI call. |
| Ask AI to decide | Retain the existing explicit AI verdict step with structured result validation. |

Use the same comparison semantics for deterministic conditions as for the shared predicate value
model. Source query support is still provider-specific. Missing in a condition is an error unless
tested by a presence operator or given an explicit fallback. An unchosen branch is skipped, not
failed. Preserve graph cycle detection, predecessor validation, joins between ordinary graph paths,
and the existing behavior of other step kinds.

Replace direct child-agent `fan-out` and its dedicated `join` step. The editor shortcut inserts a
structured planning step and a For each step whose target is a workflow. For each itself returns
ordered child outcomes, so a special collection step is unnecessary. Ordinary static file
composition can remain a compile-time feature; it must not introduce another runtime child engine.

## Record identity and loops

Source record identity comes from its host-bound reference. It requires no user-authored key pointer.
An AI or other step producing an ordinary array must declare/select a stable item field. Validate
nonempty string or finite numeric keys, using type-tagged canonical encoding to distinguish `1`
from `"1"`. Reject duplicate keys. Do not silently key records by their array position or title.
An array with no reliable identity can still be displayed but cannot use repeat tracking or dispatch
until the author selects a key.

Title defaults use the child workflow name and the record's title or stable ID. Show a title preview
and expose customization under Advanced. Branch names remain core-owned validated task choices,
not free-form provider output. Treat record titles as untrusted text.

Validate the complete eligible roster before per-item effects. An empty roster succeeds and reports
why it is empty: no matches, or all matches skipped by processing policy. Freeze record snapshots,
resolved child inputs, titles, query provenance, and child-definition references. A retry does not
rerun the source query or reread a changed saved definition.

## Dispatch and lifecycle

Extend the existing dispatcher. Reserve task and run IDs before crossing into core task creation.
The same caller key and payload returns the same dispatch. Reusing a key with different content
fails. Reconciliation resumes reserved identities and never allocates replacements after an
ambiguous call. Keep a record of selected work separate from task creation so a crash can recover
unstarted selections.

Each child keeps root, parent run, parent step, and depth. Resolve all statically referenced child
definitions before root admission, validate trust, and reject recursive definition references.
Nested child loops inherit frozen references, scope, deadline, tools, and budgets. Optional branches
do not grant additional authority.

Implementation defaults are four child-workflow levels below the root, 100 descendant tasks per
root by default, and a configurable ceiling no greater than 500. Retain four concurrent workflow
agent executions on the Node; allow a lower root concurrency. Waiting parents, gates, and record
queries do not consume agent slots. Source requests remain separately bounded by provider budgets.
The 500 ceiling counts all descendants, including conditional follow-ups. Do not treat it as 500
per loop. Check it transactionally during admission and expose the effective limit in run review.

When an initial roster exceeds the remaining limit, dispatch none of that roster. A later nested
admission may still reach the root ceiling because conditional work is not known in advance. Stop
that admission at a visible safety rail, preserve completed work, and let unrelated admitted
children settle. Do not pretend the entire graph's future cardinality can always be precomputed.

Intersect tool authority and budgets down the tree. Charge provider usage once at the root and
retain charges across retries. All runs share the root absolute deadline. Cancellation stops new
admissions, cancels descendants and managed sessions, and settles after cleanup. Recover cancellation
races against reserved and starting children through the same dispatcher.

## Results and retry

Persist a distinct terminal `completed-with-failures` outcome for a loop/run that finished its
independent work but contains failed child outcomes. Keep infrastructure/invalid-binding failure,
cancellation, and safety rails distinct. A completed-with-failures loop makes its structured outcome
available to downstream summary/condition steps; do not skip those solely because a child failed.
Unresolved descendant failures remain visible in the root outcome even if a summary step succeeds.

For each output contains ordered item references, task/run IDs, outcome, declared child outputs,
and bounded failure/usage summaries. Full results are retrieved by row ID rather than embedding
hundreds of transcripts in the parent. A nested completed-with-failures child contributes a failed
outcome to its parent. An intentionally unchosen analysis branch does not.

Keep parent waiting state while children are active. A gated child contributes attention state but
does not stop independent siblings. The root remains active for schedule overlap until all admitted
descendants settle.

Retry selects failed work explicitly. Resume the original task/run and snapshot using the existing
step retry machinery and durable dispatch identities. If the failure concerns an unknown external
side effect, expose recovery rather than claiming it is safe to repeat. Reprocess is a separate
explicit action that creates a fresh attempt, marked with its relationship to the previous one.
Completed siblings are not restarted. Updating a source record is not a repair of an old snapshot.

## Contracts to update

Update workflow definition/input/output types, route validators, TOML codec, generation catalog,
step descriptions, public extension contracts, runner capabilities, start routes, task-origin
prefill, client caches, notices, run projections, and toolkit declarations together. Keep providers
behind source operations and preserve the Node/plugin boundary. Unknown old definition formats
produce actionable upgrade errors rather than guessed conversions.

## Verify before building

Recheck the runner, dispatch, bindings, file expansion, start service, and retry code named in
[context](./context.md). Exercise nested cancellation and budget charging before adding UI affordances.
