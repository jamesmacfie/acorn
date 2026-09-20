# Slice 07: Query, details, and condition steps

Date: 2026-09-14. Status: complete.

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

Implemented `find-records`, `get-record-details`, and deterministic `if`, with explicit AI decision
kept separate. The source facade owns schema validation, paging, completeness, and authority.
The workflow runner persists frozen query resolution before reads and retains it on retry.
Record references carry host-stamped retrieval scope, which is not part of repeat identity.
Workspace queries remain usable by project runs without rewriting their authored scope.

Verification on September 14, 2026:

- `rtk pnpm lint`: 33 package checks passed. Existing oxlint warnings and sandbox cache-write warnings remain nonfatal.
- `rtk pnpm --filter @acorn/plugin-workflows test`: 36 files, 360 tests passed.
- `rtk pnpm --filter @acorn/protocol test`: 25 files, 173 tests passed, including rolling and daylight-saving calendar windows.
- `rtk pnpm --filter @acorn/node-core exec vitest run src/server/dataSources/runtime.test.ts src/server/queries/runtime.test.ts`: 25 tests passed. Covers installed dynamic discovery through details, source authority, complete selections, and shared query resolution. The query suite was rerun after adding project consumption of a workspace query; eight tests passed.
- `rtk pnpm --filter @acorn/node exec vitest run test/integration/plugins/workflowRunner.test.ts`: 24 tests passed. True and false conditions exercise persisted runner branch selection and skipping without a model call.
- `rtk pnpm --filter @acorn/arch-tests test`: four files, 63 tests passed.
- Real Tauri session `workflow-v2-phase07`: opened catalog, added Find records, edited its typed query to a valid saved reference, captured and visually inspected `.acorn/agent-dev/workflow-v2-phase07/screenshots/find-records.png`, then stopped the session. Launcher and driver required approved sandbox escalation for local IPC. Source picker and condition-builder UX remain owned by phases 12 and 13.

The structured time helper is reusable by scheduling. Incremental windows and checkpoint advancement
remain gated to processing-history and schedule implementation. Later history must identify records
by plugin/source/connection/record ID, excluding the carried retrieval scope.

## Verify before building

Read source authority and graph skip propagation. Incremental selection commit remains gated until the processing-history slice; a data step alone cannot advance a schedule checkpoint.
