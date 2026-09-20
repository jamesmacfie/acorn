# Slice 02: Source runtime and loaded-plugin parity

Date: 2026-09-13. Status: complete.

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

Implemented the shared source contract, host registry, manifest synthesis, lifecycle cleanup, scoped
POST operations, typed public facade, portable conformance fixture, and client cache keys/invalidation.
The owning reference is [typed data sources](../../data-sources.md).

Verification on 2026-09-13:

- `rtk pnpm lint`: passed all 33 package checks. Existing oxlint warnings and nonfatal shared-cache
  permission warnings remain; no lint or type errors.
- `rtk pnpm --filter @acorn/node-core exec vitest run src/server/dataSources src/server/collections src/server/pluginHost src/server/plugins/manifest.test.ts src/server/integrations/connections.test.ts`:
  277 tests passed across 14 files.
- `rtk pnpm --filter @acorn/protocol test`: 168 tests passed across 23 files.
- `rtk pnpm --filter @acorn/client-core exec vitest run src/features/dataSources/queries.test.ts`:
  two tests passed, covering scoped keys and connection invalidation with retained data.
- `rtk pnpm --filter @acorn/arch-tests test`: 63 tests passed across four files.
- `rtk pnpm --filter acorn-plugin-types test`: four tests passed, including declaration and generated
  manifest-schema drift checks. The manifest schema was regenerated with `UPDATE_PLUGIN_SCHEMA=1`.
- `rtk proxy env UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api exec vitest run src/surface.test.ts`:
  the additive API snapshot was regenerated and its test passed.
- `rtk git diff --check`: passed.

Source tests exercise compiled registration and parsed manifest bindings through the real plugin host,
core routes, and owned route dispatcher. They cover discovery scope, reload/disable, forged provenance,
foreign provider/user connections, selected-connection callbacks, deletion/revocation, malformed records,
unsupported operators/groups/sorts, removed choices, dependency cycles, partial pages, exact bounded
selection, page budgets, duplicate identities, cursor loops, oversize data, timeout, cancellation,
and details-not-found. The transport test compares nested records from both registration carriers.

No UI changed, so no real-window check applies to this slice. These tests prove manifest synthesis and
route parity; package installation and worker-process isolation are not claimed as end-to-end evidence.
The fixture is ready for the programme's installed-plugin acceptance journey. Legacy collection consumers
remain behind the documented transition until their migration slices.

## Verify before building

Read Node collection registration, plugin descriptor synthesis, provider access gates, and broker routes. Keep old consumers available only behind the temporary transition boundary.
