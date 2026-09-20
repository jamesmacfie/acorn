# Workflow v2

Date: 2026-09-20. Status: implementation complete; release acceptance remains incomplete.

Make plugin data equally usable in dashboards and workflows without assuming that every record is
a ticket. Preserve source-specific fields, support structured values throughout workflows, and
provide a readable authoring experience with complexity disclosed only when needed.

This programme includes scheduling and supersedes the separate
[scheduled workflows proposal](../scheduled_workflows/README.md). It builds on the shipped
[workflow tasks](../workflow_tasks/README.md). The owning reference documents describe the shipped
interfaces; this directory retains the design decisions, slice evidence, and final acceptance plan.

## Read first

| Document | Owns |
| --- | --- |
| [Context and decisions](./context.md) | Goal, research, runtime/data-flow map, accepted decisions, and precedents. |
| [Data contract](./data-contract.md) | Typed values, sources, query semantics, identity, discovery, pagination, and plugin requirements. |
| [Workflow contract](./workflow-contract.md) | Bindings, conditions, nested dispatch, snapshots, limits, outcomes, and retries. |
| [Publication](./publication.md) | Drafts, revisions, saved queries, conflicts, repository files, and dependency publication. |
| [Scheduling](./scheduling.md) | Occurrences, repeat policies, checkpoints, approval, overlap, and processing history. |
| [Authoring UX](./ux-authoring.md) | Workflow, query, dashboard, field-picker, and AI editing interactions. |
| [Running and scheduling UX](./ux-running.md) | Run summary, schedule activation, record history, task navigation, and recovery. |
| [AI authoring](./ai-authoring.md) | Bounded discovery, clarification, proposals, scope, and validation. |
| [Verification and transition](./verification.md) | Example journeys, failure matrix, migration/reset boundaries, and release evidence. |
| [Refused alternatives](./refused.md) | Scope boundaries and simplicity decisions. |

Read context first, then the contracts and UX pages named by the slice. A slice handed to another
engineer must be usable without the planning conversation. Do not copy contracts into slice files.

## Implementation slices

Slices 01–09 are complete. Slice 10 is implemented with automated checks passing; its real-window
verification remains blocked by the renderer startup issue recorded in its evidence. Slice 11 is
complete, including automated and real-window authoring checks.
Slice 12 is complete, including automated, real-window, and terminal-host evidence recorded in the
slice. Slice 13 implementation is complete, with automated and real-window evidence recorded in the
slice; connected-provider journeys and a live terminal capture remain acceptance checks. Slice 14 is
complete, including typed dashboard publication, real-window composition, and terminal-host boundary
evidence. Slice 15 implementation and automated checks are complete; its real-window checks through
a configured API backend and text-only harness remain acceptance work. Slice 16 is complete, including
controlled-clock, restart, race, continuation, migration, and architecture evidence. Slice 17's
implementation and automated checks are complete, with real-window evidence for activation, status,
timezone, retained-history, narrow, and keyboard flows; its live-provider and paired terminal checks
remain slice-20 acceptance work. Slice 18 implementation and automated checks are complete, with
real-window rail evidence recorded; its live-created record-table and disconnected-state journeys
remain acceptance work. Slice 19 is complete: every remaining consumer uses Node-owned typed sources,
the legacy collection and direct fan-out contracts are removed, and the versioned development-state
transition is covered against copied fixture roots. Slice 20 completed the implementation review,
controlled-host journeys, terminal pairing, and focused automation. Connected GitHub, Linear,
Rollbar, and model-provider journeys, native desktop keyboard input, and a completed repository-wide
test run remain release evidence rather than implementation work.

| Slice | Demonstrable result | Prerequisites |
| --- | --- | --- |
| [01](./phase-01-typed-values.md) | Parse and validate nested typed records and bindings. | None |
| [02](./phase-02-source-runtime.md) | An installed fixture supports discovery, options, queries, and details through the Node. | 01 |
| [03](./phase-03-github-source.md) | Query GitHub PRs by author and state with honest completeness. | 02 |
| [04](./phase-04-linear-rollbar-sources.md) | Query actual Linear states and newly created Rollbar error groups. | 02 |
| [05](./phase-05-query-library.md) | Recover, publish, and reuse a workspace saved query. | 02 |
| [06](./phase-06-workflow-values.md) | Pass typed values between workflow steps and child inputs. | 01 |
| [07](./phase-07-conditions-and-data-steps.md) | Query records, fetch details, and branch on structured results. | 02, 05, 06 |
| [08](./phase-08-child-dispatch.md) | One durable dispatcher handles nested workflows and bounded batches. | 06, 07 |
| [09](./phase-09-processing-history.md) | Track selected records, repeat decisions, and explicit retries durably. | 08 |
| [10](./phase-10-workflow-publication.md) | Recover workflow drafts and publish reviewed dependency sets. | 05, 06, 08 |
| [11](./phase-11-repository-authoring.md) | Visually publish to files and export portable workflow dependencies. | 10 |
| [12](./phase-12-shared-data-editor.md) | Configure and preview a source query with a typed field picker. | 03, 04, 05 |
| [13](./phase-13-workflow-editor.md) | Author the Linear flow in the outline editor and create its child in context. | 07, 10, 11, 12 |
| [14](./phase-14-dashboard-editor.md) | Compose and publish a dashboard with the shared query editor. | 05, 12 |
| [15](./phase-15-ai-authoring.md) | AI discovers real options, asks questions, and proposes reviewable edits. | 10, 12, 13, 14 |
| [16](./phase-16-schedule-runtime.md) | Recover approved scheduled occurrences with repeat policies and explicit timezones. | 09, 10 |
| [17](./phase-17-schedule-editor.md) | Activate, review, pause, and inspect a schedule without technical setup fields. | 13, 16 |
| [18](./phase-18-run-history.md) | Browse record outcomes and nested tasks without flooding navigation. | 08, 09, 13, 16 |
| [19](./phase-19-transition.md) | Migrate all collection consumers and remove superseded paths. | 03–18 |
| [20](./phase-20-acceptance.md) | Record complete automated and real-window acceptance evidence. | 19 |

## Completion

All three [example journeys](./verification.md#example-journeys) work through manual and AI authoring.
An installed plugin with unfamiliar nested data works without host code specific to that plugin.
Dashboards, sampling, workflow execution, and generation use the same source contract.
The old flat collection and direct child-agent fan-out paths are removed.

Record commands, outcomes, and UI evidence in each slice's evidence section. Move shipped behavior
into its owning reference documentation. Keep this index as the programme status until retirement.
