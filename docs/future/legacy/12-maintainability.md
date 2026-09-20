# Ticket 12: Naming and focused simplification

Date: 2026-09-21. Status: not started. Prerequisites: 04, 08, 11.
Read [context](./context.md), F12 in [findings](./findings.md), and [refusals](./refused.md).

## Outcome

The remaining implementation explains its present responsibilities without compatibility vocabulary
or unrelated pure/stateful concerns in the same module.

## Work

- Rename provider conformance's `legacyCache` to `cachedItem`, including Linear/Rollbar fixtures.
  Keep provider decoding and conformance tests. Replace inaccurate legacy comments on live project
  lookup with its deterministic lookup rule; retain the behaviour.
- Bring the route and connection registry names into the existing folder-owned `registry.ts`
  convention. Move their consumers and explicit exports together, preserving one registry per concern.
- Extract command session's pure row/frame construction into feature-local modules. Keep one
  `createCommandSession` owner for signals, navigation, cancellation, and async search races.
- Extract terminal region traversal/stop ordering into a pure module with explicit tree/state inputs.
  Keep focus memory, lifecycle, and dispatch in their existing state owner. Preserve traversal
  instrumentation and do not add an abstract navigation framework.
- Apply the documented Store/Prefs/model naming distinctions to files touched by this programme;
  avoid unrelated repository-wide renames. Update stale package descriptions and historical source
  comments to explain present ownership and invariants.
- Retain workflow and agent execution state machines. Their size alone does not justify a redesign;
  the legacy removals and ownership changes already reduce their surrounding complexity.

## Acceptance

Command search cancellation, back navigation, fleet result identity, setting writes, and selection
remain equivalent. Terminal nested scopes, dialogs, focus restoration, scrolling, and region traversal
counts retain existing behaviour. Run their focused suites, `pnpm lint`, and architecture tests.
Exercise keyboard/navigation behaviour in terminal and the real desktop window for shared changes.
Do not write tests that merely assert the new file arrangement.

## Verify before building

Confirm the selected functions are pure or can take explicit inputs without duplicating state.
If extraction would create a second lifecycle owner, retain the function with its state and record why.
