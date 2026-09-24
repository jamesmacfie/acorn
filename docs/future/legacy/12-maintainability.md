# Ticket 12: Naming and focused simplification

Date: 2026-09-21. Status: implemented 2026-09-23; desktop manual check remains for ticket 13.
Prerequisites: 04, 08, 11.
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

## Implementation evidence

- Provider conformance now calls its cached codec fixture `cachedItem`. The Linear and Rollbar
  fixtures still exercise decoding. Project lookup still ignores GitHub name case and selects the
  oldest matching project, using the id to break ties.
- The HTTP route registry lives in `server/routes/registry.ts`; the connection provider registry
  lives in `server/integrations/connectionProviders/registry.ts`. Each keeps its existing singleton.
  The integration provider registry remains a separate concern.
- `sessionRows.ts` and `sessionFrames.ts` construct palette values. `sessionStore.ts` still owns
  the frame stack, selection, search generation, abort controllers, and setting write. Terminal
  traversal reads explicit region, parent, collection, and panel inputs through
  `regionTraversal.ts`; `regions.ts` still owns focus, scopes, memory, and the visit counter.
- Command session tests passed (50/50). Terminal regions, key tiers, and chrome tests passed
  (58/58); the chrome renderer cases pressed Tab, arrows, Escape, and the palette chord. Node
  registry, route, and connection tests passed (18/18). Desktop host and parity
  tests passed (12/12). Type checks for client-core, node-core, Node, TUI, and desktop passed.
  Oxlint exited successfully with existing warnings. Architecture and document-path tests exposed
  the palette host-command invocation and a stale assertion for the renamed `sessionStore.ts` owner.
  Ticket 13 fixed both; its architecture rerun passed.
- The Node route and conformance integration tests passed. The plugin-disable suite passed 11/12;
  its full snapshot omits the current `plugin-authoring` context section. This phase changed only
  that test's registry import path. Ticket 13 updated the snapshot and passed the exact bounded
  whole-suite wrapper; see its acceptance record.
- `pnpm lint` stopped in pnpm 11's dependency check, which proposed removing `node_modules`.
  The existing local binaries supplied the type checks and tests above without an install. The
  real Tauri agent session requires the same pnpm staging path, so its keyboard check remains for
  ticket 13. No Acorn-owned state was reset.
