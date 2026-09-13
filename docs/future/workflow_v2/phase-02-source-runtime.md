# Slice 02: Source runtime and loaded-plugin parity

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./data-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 01. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A loaded fixture can be discovered, described, queried, and read for details through the normal Node transport.

## Work

1. Add source registration and optional dynamic discovery using one host-bound registry for compiled and loaded providers.
2. Add core describe/options/query/details routes and scoped facade calls. Validate operation envelopes and confine loaded handlers to the owning plugin route.
3. Implement bounded pagination, cancellation, completeness states, duplicate/cursor-loop detection, and typed errors. Keep provider credentials inside provider callbacks.
4. Add metadata/preview client query keys and invalidation for Node, source, connection, scope, and query digest. Do not create editor UI yet.
5. Expose the authoring operations through toolkit declarations and build the conformance fixture's portable fetch handler.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Use real plugin registration and route dispatch, including disable/reload, forged provenance, wrong connection ownership, malformed response, unsupported operator, partial pages, cursor loop, timeout, cancellation, and details-not-found. Verify both registration carriers produce equivalent records.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read Node collection registration, plugin descriptor synthesis, provider access gates, and broker routes. Keep old consumers available only behind the temporary transition boundary.
