# Ticket 03: Canonical review proposals

Date: 2026-09-21. Status: not started. Prerequisites: 01.
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
- Require target ID during preparation and use that target's schema/instructions. Remove Findings'
  literal Memory target selection. Add the automatic target setting and freeze it for preparation/retry;
  keep automatic preparation off by default. Use generic Findings bundle notices. Keep review recursion
  exclusion and frozen source/revision semantics.
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
