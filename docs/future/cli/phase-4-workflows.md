# Phase 4: workflow launch and run inspection

Status: proposed implementation handoff, 2026-09-27. Depends on Phases 1 through 3.

## Outcome and rationale

A script can discover published definitions for a task, start one with typed inputs, then inspect a
run and its steps from another process. `run list` combines available agent, workflow, and schedule
summaries for monitoring, while owner routes remain the source of full detail. The CLI does not
become a workflow executor. The Node resolves the definition, trust snapshot, capabilities,
profiles, child tasks, gates, and recovery.

```sh
acorn workflow list --task "$TASK_ID" --output json
acorn workflow start --task "$TASK_ID" --definition repo:review --inputs-file inputs.json --output json
acorn workflow run show "$RUN_ID" --output json
acorn workflow run steps "$RUN_ID" --output json
acorn workflow run wait "$RUN_ID" --until finished --check --timeout 30m
acorn run list --workspace "$WORKSPACE_ID" --output json
```

`repo:review` is illustrative; use the exact definition ID returned by `workflow list`. The CLI
must never invent an ID from a display name when more than one definition matches.

## Work to deliver

1. Add `workflow list --task ID` over the Workflows plugin's task definition route. Include each
   definition's source, stable ID, published revision or digest if available, declared inputs,
   validity/errors, and runnable state. Keep repository, user, and database definitions distinct.
   An unavailable Workflows plugin is a clear capability error, not an empty list.
2. Add `workflow start --task ID --definition ID [--inputs-file FILE|-]`. Send `defId` and typed
   JSON `inputs` to the existing route; never send an inline graph. Validate that the top-level
   input is an object and retain numbers, booleans, arrays, objects, and explicit nulls. The Node
   remains responsible for declared-name, required-value, byte-limit, and trust checks. Return a
   `WorkflowRun` resource with run and task IDs. Starting the workflow acknowledges the run; it
   does not wait for completion unless the caller runs a separate wait command.
3. Add `workflow run list --task ID`, `show ID`, `steps ID`, and `wait ID`. The existing plugin has
   task-scoped run list and run-scoped step list, but no single-run GET. Add an owner-guarded
   `GET /workflows/runs/:runId` route or an equivalent stable lookup service; do not scan every
   task from the CLI. Its ownership guard must treat unknown and foreign run IDs alike for
   task-confined callers. Define a bounded read of step status and a terminal-state predicate.
   Wait may poll at a bounded interval and use notices for low-latency refresh. After a reconnect,
   reread durable run and step state; a WebSocket notice is not the record itself.
4. Implement `run list` over `GET /v1/core/runs` and project summary kinds consistently. This
   endpoint merges agent, workflow, and schedule sources, bounds results per owner, and can report
   failed sources. Include `failedSources`, `complete`, and source limit or truncation indicators in
   machine output. A default text view visibly says when partial. Do not call this an exhaustive
   history; for a full workflow history, use `workflow run list --task`, and for agents use
   `agent list`.
5. Decide and implement a domain recovery key for manual workflow starts if retries after an
   uncertain response are required. The generic device idempotency middleware replays a saved
   non-5xx response for the same UUID key, but a Node crash after run insertion and before replay
   save can still create a second run on retry. The runner already supports `intendedRunId` for
   internal starts. Adapt that pattern to a device request ID, or make the CLI explicitly report
   ambiguity and require lookup before retry. Whichever choice is made needs a fault-injection
   test. Do not claim exactly-once starts from the generic middleware alone.

## Workflow semantics the CLI must expose

Definitions can come from repository files, user files, or database rows. The Node checks a
repository trust snapshot and step-kind availability before execution. A CLI connected as a device
can see owner-authored database definitions; an agent task principal has a narrower view. A plugin
may contribute a step kind, but the CLI only selects a published definition. It must not load
plugin code, resolve secrets, or interpret step configuration. Child-task/worktree isolation,
parallel steps, retry, gates, budget, and recovery belong to the Node runner. `--check` on a wait
returns nonzero for failed or canceled completion; a plain `show` succeeds when it reads a failed
run. A gate needing attention is inspectable and remains unresolved until an explicit authorized
action occurs. Gate approval commands can be scoped as a later extension with their own policy and
idempotency checks.

## Tests and acceptance

- With repo, user, and database definitions present, list reports source and validation status.
  Starting by a returned ID resolves the expected revision; a changed repo trust snapshot and an
  unavailable contributed step kind are refused by the Node and surfaced faithfully.
- Inputs retain JSON types. Unknown and missing fields produce actionable domain errors. A
  `--inputs-file -` and `--task -` combination that needs stdin twice fails before a start.
- A CLI starts a run, exits, and a fresh process reads run detail and steps, waits, and reports
  success, failure, cancellation, and attention. A task-confined caller cannot inspect another
  task's run ID. A 404 does not reveal whether that ID exists elsewhere.
- Repeating a saved request key does not create another run. Inject a crash in the domain-write to
  replay-save gap and verify either domain-level deduplication or an explicit ambiguous result and
  safe inspection path.
- The merged run view reports a failed source and its bounded completeness honestly. The text
  view does not imply a full history; owner-specific lists still work when another source fails.

## Verify before building

- Read `plugins/workflows/src/server/routes/workflow.ts`, `workflowStartService.ts`,
  `workflowRunStart.ts`, the shared workflow API types, `packages/protocol/src/runs.ts`, and the
  core runs route before choosing output fields or server changes.
- Read [workflows](../../workflows.md), [execution](../../workflows/execution.md), and
  [API reference](../../api-reference.md) for trust, run, and error semantics.
- After implementation run `pnpm lint`, focused Workflows and core runs tests, and the workflow
  cases in [verification](./verification.md).
