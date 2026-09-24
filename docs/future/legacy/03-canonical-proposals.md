# Ticket 03: Canonical review proposals

Date: 2026-09-21. Status: implemented. Prerequisites: 01.
Read [context](./context.md), F01 in [findings](./findings.md), and the Findings decisions in
[target architecture](./target-architecture.md).

## Outcome

`memory_write` immediately creates a human-reviewable canonical Findings proposal. No new JSON
proposal, import mapping, or legacy status mirror is produced.

## Work

- Add the specified owner-bound `submitProposal` operation to the existing review-target controller.
  Memory validates its target payload; Findings records the observation, candidate, and bundle.
  Bind the target in the controller; use the host-only authenticated adapter for Memory tool provenance
  and host-stamped plugin provenance for other contributors. Return canonical identifiers to the tool.
- Require target ID during preparation and use that target's schema/instructions, which the target
  already supplies through `synthesisContext`. Remove Findings' literal Memory target selection. Add
  the automatic target setting beside the saved backend and model, and freeze it for preparation and
  retry. Archive review is already governed by whether a backend is configured, so do not re-introduce
  a separate off switch. Use generic Findings bundle notices. Keep review recursion exclusion and
  frozen source/revision semantics.
- Change Memory's agent tool to this operation. Findings absence yields a structured unavailable result;
  it must neither directly write the library nor fall back to JSON proposals.
- Move canonical export out of the migration class. Remove legacy source contribution, importer,
  import report/map/table, Memory proposal store/generator/routes, mapped-row UI, and status mirrors.
  Update clients and commands to open canonical review records.
- Preserve owner-authored Memory editing and receipt-backed canonical application. Do not delete
  interrupted-write recovery or device approval checks.
- To keep the tree compiling before ticket 04, remove migration-readiness calls from composition and
  make existing capture callbacks use optional Findings only. Remove obsolete generator dependencies;
  retain the temporary callback placement until the following ticket moves ownership.

## Acceptance

`memory_write` produces a review without restart. Approval writes once; repeated approval is idempotent;
stale payload/revision and agent/service approvals fail. An interrupted filesystem write resumes through
the receipt. A second test target proves preparation does not assume Memory. Disabled Findings leaves
manual memory and task work usable, with proposal submission explicitly unavailable. No legacy JSON
file is created, and export still works.

Test spoofed target/session provenance, task/session mismatch, automatic target disable/removal, and
retry after target changes. An in-flight preparation must retain its selected target.

Run `pnpm lint`, Findings/Memory suites, and the Findings integration suite. Exercise the review UI
in the isolated desktop window. Schema changes use the existing chain until ticket 09 consolidates it.

## Verify before building

Inspect `plugins/memory/src/server/agentTools.ts`, `plugins/findings/src/server/runtime.ts`, and
`plugins/memory/src/server/findingsReview.ts`. Follow loaded-plugin permissions and controller disposal;
do not leave a cached writer usable after its plugin unloads.

## Implementation notes

`memory_write` now submits directly to Findings and returns the observation, candidate, and bundle
IDs. The signed task tool route mints a proof bound to the task, session, and registered tool name.
Memory passes that proof through its compiled tool handler. Findings verifies it with a declared
host facet and checks the session against the Agents roster before recording agent origin. Other
review targets use the bound controller and receive plugin origin. The observation and review rows
commit in one transaction; repeating a source key returns the same IDs.

Preparation requires a target ID. The preparation job stores it with the frozen backend, model, and
input set, and retry reads those stored values. Findings settings select an automatic target beside
the backend and model. Memory selects its own target for manual preparation. The old JSON proposal
store, importer, mappings, status mirror, and compatibility routes are removed. Canonical export and
Memory's approval receipts remain.

## Verification

- `pnpm lint`: passed across all 34 package tasks.
- Findings tests: 43 passed; Memory tests: 36 passed.
- Loaded Findings and route registry integration: 44 passed. These include immediate `memory_write`
  review, signed session checks, disabled Findings, manual Memory editing, canonical export, and
  absence of the JSON proposal directory and migration route.
- Node-core provenance and permission tests: 24 passed; client notification tests: 24 passed.
- Isolated desktop sessions `ticket03` and `ticket03b` built and booted the service, but the renderer
  displayed “Acorn could not start — Importing a module script failed.” The shell reported reset or
  broken-pipe connections to the Vite dev server for client modules. Both sessions were stopped.
