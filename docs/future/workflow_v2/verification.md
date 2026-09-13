# Verification and transition

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [ownership and decisions](./context.md). No tests in this document have been run as evidence
of workflow_v2 implementation. Record actual results in the implementation slices.

## Example journeys

Use controlled provider fixtures in automated tests, then repeat the UI flows against connected
test accounts. Provider-specific capabilities must be verified during implementation. Do not mark
incremental support available merely to satisfy an example.

| Journey | Setup and expected outcome |
| --- | --- |
| GitHub PR review | Select a connection/repository, author, and actual open state. Preview PRs, publish Find records → For each → review workflow. A closed PR is excluded independently of merge readiness. Numeric PR data remains typed. Each selected PR receives one child task. |
| Linear triage and analysis | Select connection, project, exact state, and Updated in last 24 hours. Child fetches details if needed, emits a typed Requires work boolean, and conditionally starts analysis in a grandchild task. False produces no analysis task and is not a failure. |
| Rollbar investigation | Select error groups first seen since midnight in an explicit timezone. An old group with another occurrence is excluded from this query. Each child can fetch bounded details/stack trace through Get record details. |
| Dashboard reuse | Use one of those queries inline, save it, and reference it from a workflow and panel. Edit display mappings without changing source state. Shared publication updates the panel and marks an affected schedule for review. |
| Installed unfamiliar plugin | Install the conformance fixture with nested data, dynamic options, optional fields, no static record samples, and declared incremental support. Complete discovery, dashboard composition, field binding, AI authoring, and a scheduled continuation without special host code. |

Repeat each primary workflow through manual and AI authoring. Compare resolved queries and bindings,
not generated prose. Also create a structured AI-list → For each workflow to prove the replacement
for legacy fan-out. Test empty arrays and non-source record identity configuration.

## Failure and recovery matrix

| Area | Required cases |
| --- | --- |
| Source schema | Empty results, nested arrays/objects, missing vs null, optional observed fields, incompatible used field, unrelated additions, removed selected choice. |
| Query | Several pages, exhausted vs preview, upstream cap, repeated cursor, conflicting duplicate ID, unsupported filter/group/sort, timeout, cancellation, oversize data. |
| Bindings | Whole record, numeric/boolean input, explicit conversion, fallback, missing required field, unsafe pointer, sibling instead of predecessor, stale field selection. |
| Publication | Recoverable draft, two-device edits, stale AI proposal, publish dependencies, interrupted core/plugin writes, repository file conflict, interrupted export, deleted dependency. |
| Dispatch | Crash before/after reservation, task creation, run start, nested dispatch, and cancellation; same IDs reused; changed payload under same key rejected. |
| Batch | Zero matches, all skipped, mixed child outcomes, approval gate with running siblings, root descendant limit, four-slot execution ceiling, explicit retry without restarting siblings. |
| History | Same record in independent schedules, stable identity on rename/reorder, A → B → A tracked changes, field-set edits, source/connection changes, explicit reset, failed unchanged record, changed record after failure. |
| Schedule | First baseline failure, Run now vs timer race, overlap skip, downtime catch-up once, pause vs cancel, changed graph, expired token, half-open time boundaries, daylight-saving gap/fold. |
| Checkpoint | Crash before and after selection/intent/boundary commit, incomplete selection, zero-match commit, all-skipped commit, cancellation after commit, rejection of first-N incremental selection. |
| Authority | Disabled plugin, deleted connection, revoked capability, out-of-project scope, forged record provenance, task caller attempting authoring approval, no secrets in returned errors. |
| UI | Cold source, stale preview, failed refresh with preserved rows, narrow window, keyboard-only configuration, terminal region navigation, focus restoration, 500-row history. |

Use small pure tests for schema/binding/predicate semantics, real temporary SQLite stores for
reservation and publication recovery, and composition tests for loaded-plugin routing. Place tests
beside their owning code. Avoid tests that only duplicate implementation constants or mock away the
cross-database boundary they claim to verify.

## Development-state transition

No data deletion is performed by writing these documents. The implementation can use a targeted,
explicit development reset at cutover because the user has approved losing obsolete development
workflow/dashboard state. Do not run the repository-wide reset command as a shortcut.

Inventory exact keys/tables in the owning stores before implementing the reset. Cover old workflow
definitions/runs/steps/dispatch state, obsolete workflow trigger state, dashboard panel definitions,
placements/layouts, and associated measure samples only where incompatible. Clear corresponding
device cache/recovery entries through a versioned namespace. Do not delete the entire prefs store
or plugin database without proving every contained table is in the reset scope.

Require no active workflow/scheduled dispatch and stop relevant writers before reset. Record a
backup or recoverable export of the targeted state and a manifest of exact targets. Preserve core
tasks, task links/lineage, worktrees, notes, managed sessions, credentials, connections, pairings,
and repository/user-authored files. Historical tasks may outlive workflow rows; their UI must handle
an unavailable run link without throwing. Do not erase unrelated records to remove that link.

Legacy workflow files receive a format-version/upgrade diagnostic with their location. Update
repository-owned examples and fixtures to the new contract, but do not delete arbitrary user files.
The implementation handoff must identify any manually edited examples before transformation.
All new state follows normal owning migration chains. This is not permission to reset future
production installations silently or to rewrite unrelated shipped migrations.

## Complete collection migration

Inventory compiled registrations, loaded manifests, public SDK types, descriptor synthesis,
client cache keys, core tasks, agent sessions, GitHub, Linear, new Rollbar data sources, panel
regions, pure mappings/aggregates, and Node measure sampling. Built-in client fetch callbacks must
not survive as a second authoritative source path. Preserve optional unavailable task status honestly.

Retire legacy flat collection schemas, opaque query params, cold-cache discovery, direct fan-out,
and its dedicated join only after replacement consumers pass. Preserve ordinary graph joins and
existing unrelated step kinds. Remove transition adapters/gates rather than leaving silent fallback
execution. Keep unsupported old formats visible and actionable.

Update the affected owning docs when behavior ships: architecture, data layer, state ownership,
workflows, dashboards, schedules, integrations, agent tools, plugin contracts/authoring, frontend,
API reference, and testing. This programme supersedes dynamic-collection discovery restrictions
that required SQL panels first. SQL connection execution and dashboard write-back remain separate.

## Commands and real-window checks

For each slice, run `pnpm lint` and its focused suites. For release acceptance, run:

```bash
rtk pnpm lint
rtk pnpm test
rtk pnpm db:check
rtk pnpm --filter @acorn/arch-tests test
```

Use the repository's complete-suite command so its concurrency bound remains effective. Record
unrelated failures separately, including command output and the affected baseline. Do not report
a suite as passing if only a subset ran.

On a graphical host, use an isolated session with `pnpm dev:agent -- --session workflow-v2`.
Use `pnpm dev:agent:ui -- --session workflow-v2 snapshot`, then the documented click/fill/screenshot
commands. Refresh the snapshot after each transition and stop the session when done. Use the
[local development guide](../../local-development.md) for exact driver syntax. Verify each journey,
the recovery states, keyboard operation, and narrow layouts in the real Tauri window. Record terminal
interaction evidence too. Native dialogs use the host's supported native inspection path.

Do not call the programme complete with only parser, component, or DOM snapshots. Include the real
window evidence, source conformance, crash recovery, and a 500-descendant bounded load fixture.

## Verify before building

Confirm the exact collection inventory and reset targets against the current checkout and data
schema. Read the repository's testing and archive lifecycle docs. Treat this survey as a baseline,
not proof that unrelated concurrent work has stayed unchanged.
