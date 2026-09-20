# Slice 10: Workflow draft recovery and dependency publication

Date: 2026-09-20. Status: implemented; real-window acceptance blocked by renderer startup.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./publication.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 05, 06, 08. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A parent and its new child/query drafts can be reviewed and published as one recoverable operation.

## Work

1. Add workflow draft and immutable revision storage, autosave services, base revisions, and device recovery contracts.
2. Resolve and validate selected dependency revisions, detect cycles, and produce a consumer-impact review.
3. Implement prepared/publishing/complete/needs-reconciliation publication state and idempotent dependency-first writes across owning stores.
4. Block admission through incomplete publication sets and expose landed revisions/remaining work after interruption.
5. Add semantic conflict reconciliation by stable IDs and preserve unresolved drafts. Make Run resolve only published definitions.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test unfinished draft recovery, save conflicts, merge/delete/reorder conflicts, unpublished dependencies, concurrent dependency edits, crash after each publication write, idempotent resume, and refusal to execute an incomplete set.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implemented draft/published revision separation, affected-row save checks, semantic stable-ID merge,
750 ms autosave, device recovery, dependency review, and the recoverable publication journal.
Database run resolution reads immutable revisions. The HTTP start route refuses inline drafts.
Run admission pins saved-query revisions before effects. The editor exposes review, publish, resume,
discard-before-writes, conflict choices, and published-only Run.

The query store participates through a compiled-host capability. It retains operation holds and
idempotent writes rather than sharing a transaction with workflow storage. Metadata validation uses
descriptions and options. Explicit per-workflow validation inputs/step values are accepted for
parameter-dependent metadata; no record samples are fetched by publication.

Verification on 2026-09-20:

- `pnpm lint`: 33 package tasks passed after fixing request narrowing and one test fixture type.
- Workflow owning suite: 389 passed initially, with six lifecycle/test-isolation failures.
  The focused rerun covered all six fixes plus publication, merge, and recovery: 75 tests passed.
- Final publication/recovery checks: 10 passed after preserving older recovery copies until an
  exact acknowledgment and preserving frozen query content across later draft edits.
- Core query runtime: nine passed, including held revisions, ambiguous write replay, mixed-scope
  release, and publication without record reads.
- Architecture: 62 passed initially; the plugin-name coupling failure was removed. The 52-test
  boundary rerun passed. The other 11 checks passed in the first run.
- Published declaration contracts: four passed. `pnpm db:check`: all 11 migration chains passed.

Real-window attempt used isolated session `workflow-v2-phase10`. The launcher and Node reached
ready, but the main Tauri window stayed blank. The inspected screenshot is
`.acorn/agent-dev/workflow-v2-phase10/screenshots/phase10-start.png`; Node startup logs are under
`.acorn/agent-dev/workflow-v2-phase10/logs/desktop.log`. Custom-scheme module fetches returned HTTP
200 with JavaScript MIME types. Direct imports of agents, changes, context, docker, editor, github,
memory, and onboarding succeeded. Notes, preview, terminal, and workflows failed with
`TypeError: Importing a module script failed.` The session was stopped. This is not visual acceptance;
the shared renderer import failure must be resolved and publication controls checked in phase 13/20.

Phase 11 can reuse the operation journal/read model for file authority. Phase 13 can extend the
review controls through `WorkflowPublicationSelection`, the merge choices, and the draft store;
the richer outline editor is not part of this slice. Phase 16 owns schedule consumer review notices.

Two follow-up integrity checks were closed before phase 11. Query deletion refuses active publication
holds. Draft query consumers are registered before acknowledging a draft save, tracked in workflow
dependency rows, and reconciled after edits, deletion, or restart. Separate draft/published consumer
identities prevent draft edits from dropping published references. Focused regressions passed:
13 workflow draft/publication tests and nine core query tests. No public contract or migration changed
in this follow-up; broad lint and suite runs were not repeated. `git diff --check` passed.

## Verify before building

Read source scope validation and existing graph freezing. Use feature-owned coordination through core capabilities; do not import workflow implementation into core or promise multi-database atomicity.
