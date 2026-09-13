# Slice 07: Query, details, and condition steps

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./workflow-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 02, 05, 06. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A workflow queries records, obtains details, and chooses an If branch from a typed result.

## Work

1. Add Find records using source runtime and inline/published query resolution. Freeze evaluated arguments and time for all pages.
2. Persist complete validated selection output and its provenance. Surface incomplete selection before any dependent loop can dispatch.
3. Add Get record details from an exact host-bound reference and persist the result/read time.
4. Add deterministic If/otherwise evaluation and branch validation using the shared typed comparison semantics.
5. Keep Ask AI to decide separate and update descriptions/catalogs so all new steps can be authored manually and generated.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Exercise zero matches, incomplete/oversize selections, detail not-found, optional fields, true/false branches, missing condition values, and source permission revocation. Verify a condition requires no model call.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read source authority and graph skip propagation. Incremental selection commit remains gated until the processing-history slice; a data step alone cannot advance a schedule checkpoint.
