# Workflows Node and data model

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-WF`

## Definition model and loading

A definition contains:

- stable ID, name, source, revision/digest, posture `gated|autonomous` and optional trigger;
- workflow tool ceiling and budgets;
- an ordered list of steps; and
- per-step name, kind, profile capability, model, prompt template, output schema, policy,
  iteration bound, required run target, child-step definition, join, branches, tool ceiling and
  budgets.

Budgets are `maxWallTimeMs`, `maxCostUsd`, `maxInputTokens`, `maxOutputTokens` and `maxTurns`.
Tool ceilings contain exact allowed tool IDs and optional maximum risk `read|write|execute`.

`CUR-WF-020` Definitions are loaded from trusted repository
`.acorn/workflows/*.toml`, then the Node owner's V2 workflow directory; repository definitions win
by ID. Source path is redacted to `repo:<id>` or `owner:<id>` at protocol boundaries.

`CUR-WF-021` A repository definition is executable configuration and cannot start until the exact
configuration snapshot is acknowledged. Reading/listing it is permitted so the owner can review
validation and requested authority.

`CUR-WF-022` The loader accepts at most 256 files, 1 MiB each, 256 expanded steps per workflow,
eight nested sub-workflow levels and 4 MiB expanded canonical definition. IDs/names are bounded to
200/120 characters.

`CUR-WF-023` Sub-workflows expand statically with prefixed step names, joins, branch targets and
template references. Unknown references, cycles, duplicate names and any expansion limit are
visible definition errors and produce no runnable definition.

`CUR-WF-024` Template syntax is exclusively `${steps.<name>.output}`. It may reference only an
earlier successful step. Invalid, forward or skipped/failed references fail validation or the
step; arbitrary expressions and environment interpolation are prohibited.

`CUR-WF-025` JSON output schemas are closed/bounded, use the supported local JSON Schema profile
and contain no remote references or executable formats. Schema bytes are digest-pinned in the
frozen run definition.

`CUR-WF-026` Validation rejects unknown kinds, profiles, policies and capabilities; dangling or
non-preceding fan-out joins; backward/unknown branch targets; widened tools/budgets; invalid
posture/trigger; unsafe prompts/schemas; and missing required dependencies.

`CUR-WF-027` Definitions are immutable resources keyed by source and digest. Editing a file creates
a new revision. An existing run continues with its frozen canonical definition and exact
dependency/schema versions.

## Durable resources and tables

| Table | Authoritative purpose |
| --- | --- |
| `p_definitions` | latest validated/invalid source metadata and canonical digest |
| `p_definition_revisions` | bounded canonical definitions referenced by runs |
| `p_runs` | task, definition, status, posture, trigger, authority/budget checkpoint |
| `p_steps` | ordered/child step state, attempt, worktree/task relation, outputs and usage |
| `p_gates` | durable gate request, decision and actor |
| `p_handoffs` | run-scoped bounded structured/text handoff snapshots |
| `p_child_relations` | fan-out parent step to core child task |
| `p_operations` | dependency-call saga/idempotency/unknown-outcome state |
| `p_trigger_cursors` | provider cursor, dedup key and next evaluation |
| `p_outbox` | plugin facts awaiting core outbox import |

`CUR-WF-028` Plugin storage contains core resource URIs and immutable dependency operation IDs. It
does not duplicate task ownership, provider transcript, terminal output, GitHub mirror, note body,
secret, process handle or absolute worktree path.

`CUR-WF-029` A run stores ID/URI, task URI, definition URI/digest/canonical snapshot, status,
posture, trigger ID/dedup key, initiating actor/delegation reference, effective ceilings/budgets,
error class/safe detail, revision and timestamps.

`CUR-WF-030` Run statuses are `running`, `gated`, `cancelling`, `done`, `failed`, `safety-rail` and
`cancelled`. Terminal statuses are immutable except owner-visible recovery metadata; retry creates
a new run related to the original.

`CUR-WF-031` A step stores ID/URI, run, sequence index, parent step, name, kind/provider version,
mode, status, task/worktree resource relation, attempt, rendered-input digest, result/structured
output, session relation, cost/usage, iteration, error, revision and timestamps.

`CUR-WF-032` Step statuses are `pending`, `running`, `waiting-gate`, `done`, `failed`, `skipped`,
`safety-rail` and `cancelled`. Only the runner's compare-and-set transition may change status.

`CUR-WF-033` Prompt/context bodies, structured output and handoffs are sensitive plugin data,
application-encrypted at rest, individually capped at 1 MiB and excluded from product-event
payloads. Larger Agent artifacts remain in Agents and are referenced by URI.

`CUR-WF-034` Backup includes definitions referenced by history, runs, steps, gates, handoffs,
relations, operation outcomes and trigger enablement/cursors under application encryption. It
excludes live streams and reproducible source scans.

## Runner state machine

`CUR-WF-035` Start validates definition revision, config trust, task/worktree, dependencies,
authority, budgets and trigger dedup, then atomically inserts run, all top-level pending steps and
`run.started` outbox fact before returning `accepted`.

`CUR-WF-036` The runner serializes top-level advancement per run. It selects the lowest-index
non-terminal top-level step not skipped, compare-and-sets it to running with an attempt ID, then
invokes its provider outside the database transaction.

`CUR-WF-037` A provider outcome and operation ID are persisted before the step checkpoint. The
runner writes step result/status, handoff and outbox facts atomically, then advances or terminates
the run.

`CUR-WF-038` The Node permits four concurrent Agent-execution operations per Workflows installation
by default. Queued steps remain `pending`; host/owner policy may lower but not raise the hard
installation ceiling without a versioned policy change.

`CUR-WF-039` Cancel compare-and-sets the run to `cancelling`, revokes active operation leases,
requests dependency cancellation, marks nonterminal steps/children cancelled after classified
outcomes, then commits run `cancelled`. It never reports terminal cancellation while an unknown
post-commit effect is unresolved.

`CUR-WF-040` Kill targets one running/waiting step. Killing a top-level step terminates the run;
killing a fan-out parent cancels the run and child operations; killing a child marks that child
cancelled and lets the explicit join determine failure.

`CUR-WF-041` Node restart reconciles every `running`/`cancelling` run against persisted dependency
operation IDs. A known uncommitted operation may retry idempotently; a known result is applied; an
unknown external outcome moves the run to `gated` recovery rather than repeating side effects.

`CUR-WF-042` Completion hides the run handoff from default future context while retaining it for
audit/history, invokes optional Memory review once by idempotency key, and emits terminal facts.
Memory failure cannot change the terminal run result.

## Built-in step semantics

`CUR-WF-043` `agent` assembles declared immutable context snapshots, optionally ensures a required
Terminal run target, invokes `acorn/agents.session-execute@2`, validates structured output, records
usage and commits a handoff.

`CUR-WF-044` `gate-human` in gated posture creates one durable pending gate and stops advancement.
Approve commits the step done and resumes; reject commits failure and terminates. In autonomous
posture it records an explicit policy-approved result only when the definition/grant allows bypass.

`CUR-WF-045` `gate-policy` invokes the declared policy provider against current authoritative
resources. It ignores an Agent's claimed verdict and fails closed on unavailable/unknown policy.

`CUR-WF-046` `ci-loop` re-reads authoritative check state before each attempt, resumes the same
managed Agent relation where supported and stops green, failed, cancelled or `safety-rail`.
Iterations are bounded by the minimum of step `maxIterations`, budget turns and hard eight.

`CUR-WF-047` `fan-out` asks an Agent for schema-conforming seeds, rejects empty/invalid output and
more than twelve children, creates core child tasks through an idempotent saga, inserts child step
rows, then executes children under the four-slot semaphore and narrowed child policy.

`CUR-WF-048` `join` names one preceding fan-out and returns ordered child status/output/task
relations. It is all-or-nothing: any non-done child fails the join and run; there is no implicit
nearest fan-out.

`CUR-WF-049` `decide` invokes a tool-free structured Agent operation, requires scalar `verdict`,
chooses exact verdict or `default`, and skips untaken branch targets/intervening steps. Missing
match/default or invalid target fails the run.

## Budgets, triggers and retention

`CUR-WF-050` Workflow, step and child budgets intersect by minimum. Hard maxima are 24-hour wall
time, USD 1,000 declared cost, 10 million input/output tokens each and 100 turns; Node policy may
lower them. A reached limit produces `safety-rail`, not ordinary failure.

`CUR-WF-051` Usage is accumulated from authoritative provider results. Missing metering cannot be
treated as zero when a relevant budget is required; autonomous execution is blocked unless policy
defines a conservative bound.

`CUR-WF-052` Trigger providers export bounded candidate events/cursors to the Node scheduler.
Workflows evaluates at most every 30 seconds by default with jitter/backoff and persists a unique
`(trigger,definition,task,sourceEvent)` dedup key before start.

`CUR-WF-053` Background triggers run whether Electron is visible or connected. A human gate,
permission prompt, dependency outage or safety rail becomes durable attention and waits/fails
according to declared policy; it cannot be auto-approved by elapsed time.

`CUR-WF-054` Default history retention is owner-configurable 30–365 days, 180 days by default.
Active/gated runs and audit-required operation records are not age-purged. Purge tombstones resource
relations and preserves minimum security audit.

`CUR-WF-055` Storage quota defaults to 1 GiB. At 80% the Node warns and stops retaining nonessential
progress; at 100% it refuses new runs before creating side effects while allowing cancel/gate/
export/purge.

`CUR-WF-056` Data conformance MUST cover every transition, CAS race, dependency outcome class,
restart point, fan-out partial failure, trigger duplicate, budget boundary, encryption/backup,
retention and quota state.
