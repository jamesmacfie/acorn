# Slice 15: Contextual AI discovery and proposal review

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ai-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 10, 12, 13, 14. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

AI authors the same query/workflow/dashboard definitions as the visual editor using real source metadata.

## Work

1. Add bounded feature-owned authoring conversations and the metadata-request/clarification/proposal response loop.
2. Route validated discovery/describe/options requests to the shared data service and keep API/CLI text backends supported.
3. Add explicit sample opt-in, bounded selected preview samples, cancellation, usage reporting, and recoverable pending questions.
4. Validate candidates with the same feature validators; show semantic diffs and apply one undoable edit after review.
5. Reconcile stale proposals against draft revisions and expose read-only discovery through the existing agent-tool/MCP projection with ordinary scope checks.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Use fake model sequences for real option lookup, ambiguity, invalid field/operator, dropped-filter refusal, repair limits, cancellation, opt-in samples, prompt-injection-like record content, and stale draft changes. Repeat the three examples with a real configured backend.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read model transport and generation protection code. Do not expand into an unrestricted managed agent, publish/run tools, credential access, or a second MCP server.
