# Phase 2: add cancellable search and explicit input submission

Planned 2026-09-03 at `7d62e3ec`. Shipped 2026-09-03.

## Status

- Priority: P1
- Effort: large
- Risk: high; asynchronous ordering and loaded-wire validation are correctness and security boundaries.
- Depends on: phase 1

## Purpose

Complete the interactive engine with search and single-text input, then expose those kinds to loaded
manifests through bounded plugin routes. This phase proves the mechanics with fixtures and adapters;
first-party migrations happen in phases 4 and 5.

## Prerequisites

- Phase 1 owns all palette transitions in one tested session.
- Read node fan-out, API client cancellation, plugin route ownership, chrome action execution, rail
  item sanitization, manifest cross-validation, and generated JSON Schema tests.
- Confirm the standard plugin error envelope and interactive-owner checks used by loaded write routes.

## Behavioural changes

- Search frames call a provider after their minimum query and debounce rules, show distinct
  instruction/loading/empty/error states, and ignore cancelled or stale responses.
- Input frames submit only on explicit Enter, show pending state, reject duplicate Enter, preserve
  input on error, and execute a success action only after the submit route succeeds.
- Commands declare scope. Fleet queries fan out only when explicitly declared and keep successful
  rows beside per-node errors.
- Loaded manifests may declare action, group, search, or input commands. Existing action descriptors
  and the legacy `palette` alias remain valid.

## Boundaries

### In scope

- Search/input variants in the shared session and compiled command API.
- Scope resolution and fleet fan-out.
- Loaded command descriptor union, wire sanitizers, route adapters, and async chrome outcomes.
- Test fixture plugins for every new loaded descriptor.

### Out of scope

- Setting commands, production plugin search endpoints, result secondary actions, persistent query
  history, cross-session result caching, and custom plugin UI.

## Migration steps

1. Add search and input frames to the session. One active abort controller belongs to the top frame;
   pop, close, context invalidation, or new generation aborts it.
2. Implement compiled search defaults and the stricter loaded bounds: 250 ms debounce, two trimmed
   characters, 50 displayed results, and manifest debounce range 150–1,000 ms.
3. Schedule only after IME composition ends. Clear selectable results when a new query starts; show a
   loading row until the matching generation returns. Silently discard aborts and stale generations.
4. Implement input validation, pending state, duplicate guard, abort-on-pop, `close`/`stay` outcomes,
   and error preservation.
5. Resolve `none/task/project/workspace/node/fleet` against the captured context. Hide a command whose
   required identity is missing. For fleet, ask the existing fan-out layer for capable nodes,
   namespace IDs, attach node labels, and represent partial failures without failing successful rows.
6. Add the additive loaded manifest variants:
   - action with omitted `kind` remains current behavior;
   - group contains no action;
   - search names a confined GET route and static select action;
   - input names a confined POST route and static success action.
   Validate local parent graphs across the whole command array before registration.
7. Implement strict sanitizers and length/count bounds for `CommandSearchItem` and input success
   response. Never read an action, URL, or route from response data.
8. Make the palette's chrome-action path await completion. Have `runNodeAction` return failure rather
   than only scheduling a toast; keep other click sites valid by discarding the promise explicitly.
9. Regenerate `packages/plugin-types/acorn-plugin.schema.json` from the Zod contract and update public
   declaration/docs fixtures needed to compile a third-party manifest.
10. Keep `PaletteRowSource` as an adapter. Add a compiled search adapter capable of loading once on
    entry and locally filtering with zero remote debounce, ready for terminal/workflow migration.

## Tests

- Fake-timer debounce: rapid `r`, `ro`, `rol` causes only the final eligible call.
- Minimum length and whitespace normalization.
- Abort on query, pop, close, context change, and provider disposal.
- A provider that ignores abort cannot apply an old generation.
- Loading, empty, error, retry, and successful-selection transitions.
- Input validation, one submit, duplicate Enter, abort, failure preservation, `stay`, and success.
- Task/project/workspace absence; node routing; fleet ID collision and partial failure.
- Loaded manifest legacy parse plus valid/refused group/search/input descriptors.
- Route confinement, scope parameter derivation, malformed/capped result sanitization, and response
  actions being ignored.
- `runNodeAction` success and error propagate to the palette while old callers still surface errors.
- Generated JSON Schema equals the committed file.

Run:

```sh
UPDATE_PLUGIN_SCHEMA=1 pnpm --filter acorn-plugin-types test
pnpm --filter @acorn/protocol test
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/tui test
pnpm lint
```

Run the schema test again without the environment variable to prove the committed bytes match.

## Exit criteria

- Both hosts expose every search/input state from the same session fixtures.
- Search cancellation plus generation checks prevent stale replacement.
- Loaded response data cannot choose behavior and is bounded before rendering.
- Fleet traffic occurs only for `scope: 'fleet'`.
- Existing loaded action commands and `palette` aliases still work unchanged.
- The public schema and declarations describe exactly what the runtime accepts.

## Rollback posture

The manifest additions are public once released. Before release they can be reverted with the
interactive variants and schema together. After release, disable their registration behind the
existing manifest compatibility path rather than rejecting already-valid manifests. The compiled
session features are additive and can remain unused while a route adapter is repaired.

## STOP conditions

- Scope authorization can be enforced only in the client.
- A loaded result must supply an arbitrary action to support the proposed proof cases.
- Abort is being used as the only stale-response guard.
- Making chrome actions awaitable would suppress errors at an existing non-palette click site.
- The JSON Schema cannot express the additive legacy/action union without invalidating old manifests.

## Verify before starting

- Re-read the current plugin API versioning policy and manifest cross-field refinements.
- Confirm route builders and API clients still support `AbortSignal` and explicit node IDs.
- Inventory every `runChromeAction` caller and its current error surface.
- Confirm the fleet adapter's current collision and partial-failure conventions.
- Re-run phase 1's cross-host session fixtures.

