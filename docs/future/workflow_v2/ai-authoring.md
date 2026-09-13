# AI authoring over discovered data

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions](./context.md). UI behavior is owned by [authoring UX](./ux-authoring.md).

## One source of facts

Visual and AI authoring use the same source registry, describe/options operations, typed schemas,
published workflow catalog, and validators. The model does not invent available Linear states,
connection IDs, child targets, filter operators, or field types. Provider data is untrusted content,
not authoring instructions or permission to broaden scope.

Keep provider-backed and CLI text-generation backends working. The baseline generateText interface
has no tool-call protocol. Implement a bounded feature-owned authoring loop whose model response is
one of: request metadata operation, ask user clarification, or propose a candidate definition.
Execute only validated allowlisted metadata requests on the Node, append their structured results,
and ask the model again. This avoids requiring a different model transport or unrestricted managed
agent session just to author a workflow.

A direct tool-capable backend can adapt to the same requests later, without changing source APIs.
Expose read-only source discovery/describe/options through the existing MCP/tool contribution
projection for external authoring agents. The in-app generator calls the same service directly;
it does not start a second MCP server. Task-scoped callers remain confined to granted scope.

## Conversation state and operations

Store a bounded conversation with its owner, target draft identity/revision, selected Node/workspace,
optional project/connection scope, chosen backend/model, and sample opt-in. Persist pending
clarification and proposal state so navigating away does not discard work. Do not put authoring
conversations in execution transcripts or count them as workflow runs.

Allowed metadata operations list sources, describe a source, resolve option pages, list compatible
published child workflows, and validate a candidate. Queries for record samples require the explicit
opt-in and use the ordinary bounded preview path. The model cannot publish, run, activate schedules,
write provider state, change permissions, or read credentials through this loop.

Default to eight metadata requests and two candidate validation/repair attempts per submitted user
instruction. Bound response bytes and conversation context; summarize older instructions with their
accepted decisions rather than silently dropping them. Stop with an actionable explanation when the
budget is reached. A user continuation starts another bounded turn. Record backend usage separately
from workflow runtime usage. Cancellation aborts in-flight requests and retains the last valid draft.

## Samples and clarification

Discover schemas and live option labels automatically within the user-selected scope. Record contents
are not included unless **Use preview records to help AI** is enabled for the authoring conversation.
Show the selected backend and which preview/source the sample comes from. Default to at most three
records and 16 KiB total serialized sample content. Exclude unrelated fields where a selection is
available. If the bounded projection does not fit, omit the sample with an explanation rather than
silently truncating a value. Opt-out stops future sample sends; it cannot retract prior provider calls.

When several projects, states, or workflows fit, ask a short inline question with real option IDs
and labels. Keep the partial proposal. Do not select the first account or substitute a similarly
named state. If a source is unavailable, distinguish that from no matching choices. A free-text
clarification is still validated against discovery before it becomes a binding.

## Candidate validation and review

Use the same pipeline for generated workflow, query, and dashboard changes: parse supported format,
resolve known references, validate typed values/operations/dependencies, and produce a semantic diff
against the base draft. Keep feature-owned validators. Share data discovery and pure value/diff
helpers without creating a universal artifact framework.

Do not repair invalid source filters by deleting them. Return a specific problem to the model or
user. Do not coerce unsupported values into strings. Unavailable references remain visible as setup
gaps when safe to keep in a draft. Publish/run validation still refuses unresolved executable input.

Show a readable proposal, including changed source scope, child targets, and repeat settings where
applicable. Apply only after review and as one undoable draft edit. The prior blanket restoration of
child targets is replaced by this explicit review. If the draft changed meanwhile, reconcile by
stable IDs and revalidate; never overwrite the newer draft with a stale whole-definition response.
Publication and schedule approval remain separate user actions.

## Tests

Use deterministic fake model replies for metadata requests, option choices, clarification, malformed
responses, invalid references, budget exhaustion, repair, cancellation, and concurrent draft edits.
Verify the same source facts reach the visual editor and authoring loop. Test both API and text-only
CLI backend adapters. Real provider/model runs are acceptance evidence, not deterministic unit tests.

## Verify before building

Recheck generate/ground/validate, backend transport, model-picker preferences, agent-tool projection,
and current task-scope gates. Reuse their transport/authentication rather than broadening privileges
for authoring convenience.
