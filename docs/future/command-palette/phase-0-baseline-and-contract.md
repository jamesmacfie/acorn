# Phase 0: pin the baseline and introduce the command contract

Planned 2026-09-03 at `7d62e3ec`. Not started.

## Status

- Priority: P1
- Effort: medium
- Risk: medium; the command type and executor feed every shortcut even though this phase changes no
  visible palette behaviour.
- Depends on: nothing

## Purpose

Make the current behaviour executable as tests, then introduce the internal command union,
execution context, outcomes, neutral result wire type, and graph validation without accepting a
loaded manifest feature the current palette cannot render. Phase 1 must be able to build the session
against stable contracts rather than changing types and behaviour simultaneously.

## Prerequisites

- Read [README.md](./README.md), [review.md](./review.md), and
  [architecture.md](./architecture.md) fully.
- Read the current command registry, palette model, both host palettes, keybinding command layer,
  plugin context ownership wrapper, plugin contract, chrome registration, and manifest schema test.
- Run the existing client-core, protocol, TUI, and chrome-registration tests and record any baseline
  failure before editing.

## Behavioural changes

There is no user-visible change. Existing commands remain leaf actions, current palette rows still
load on open, and loaded manifests remain limited to the command descriptor supported today. The
new types and validator are exercised directly but interactive descriptors are not wired into the
manifest parser until phase 2 can render them.

## Boundaries

### In scope

- The client-core command registry and executor.
- A host-neutral command contract module in protocol for result/context-free wire facts needed by
  later loaded descriptors.
- A pure command-graph projection/validation module and its tests.
- Characterization tests around current command visibility, execution, palette composition, and
  direct keybinding behavior.

### Out of scope

- Palette rendering, nested navigation, async queries, loaded route calls, settings, and plugin
  migrations.
- Changing shortcut precedence or focus policy.
- Editing the current manifest command shape to accept search/input/setting before an engine exists.

## Migration steps

1. Add characterization tests that prove:
   - `palette: true` and availability are both required for current palette discovery;
   - `executeCommand` re-checks availability and awaits an async action;
   - loaded manifest IDs and legacy `palette` entries are qualified and gated on the active node;
   - desktop and TUI compose command, task, workspace, contributed, and error rows in their current
     order;
   - a command shortcut invokes the same registered leaf as the palette.
2. Define `CommandExecutionContext`, `CommandScope`, `CommandOutcome`, and bounded
   `CommandSearchItem` types. Export the loaded-wire types from an explicit protocol package export;
   do not put host adapters or Solid state into protocol.
3. Convert `CommandContribution` into a discriminated internal union whose compatibility member is
   `{ kind?: 'action', run(context) }`. Existing zero-argument functions must remain assignable and
   require no bulk rewrite.
4. Change `executeCommand` to accept an optional context and normalize `void` to the default `close`
   outcome. Keep callers that do not have a palette context working.
5. Add a pure graph builder that resolves titles/hints, checks duplicate IDs, parent ownership,
   parent kind, cycles, inherited availability, sibling order, breadcrumbs, and descendant root
   search. It may be unused by the old palette until phase 1, but its API and cases are complete.
6. Stamp ownership in the compiled plugin contribution wrapper as well as loaded chrome
   registration. Ownership is internal metadata and cannot be supplied by plugin code.
7. Add architectural boundary tests so protocol imports no client package and host renderers do not
   become part of the graph module.

## Tests

- Model graph tests after the current registry tests: duplicate, valid tree, orphan, non-group parent,
  same-owner enforcement, cycle, unavailable ancestor, sibling ordering, and breadcrumb search.
- Extend command executor tests for synchronous success, asynchronous success, thrown error, absent
  command, unavailable command, and legacy zero-argument callbacks.
- Extend chrome registration tests only for ownership and unchanged legacy parsing.
- Keep current palette-model and overlay tests unchanged and green; they are the parity baseline.

Run:

```sh
pnpm --filter @acorn/protocol test
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/tui test
pnpm lint
```

Expected: exit 0, with no change to existing palette snapshots or visible behaviour.

## Exit criteria

- The union, context, outcome, search-item wire type, owner stamping, and graph validator exist and
  have exhaustive tests.
- Every existing command registration compiles without adding `kind` or a context parameter.
- Loaded manifests that omit `kind` still parse exactly as before; no unsupported interactive
  descriptor is accepted yet.
- Current desktop and TUI palette behaviour is pinned by characterization tests.

## Rollback posture

This phase is additive except for the internal command type/executor signature. Revert the new graph
and protocol modules and restore the old executor if a downstream registry assumption appears. Do
not “fix” a characterization mismatch by changing current behaviour; record it and amend the later
target if the owning document proves it intentional.

## STOP conditions

- Existing desktop and TUI palette behaviour materially disagrees before the phase begins.
- Adding owner metadata requires a plugin to provide or persist the owner itself.
- Existing zero-argument command callbacks cannot remain source-compatible.
- The neutral wire type would need to import a client, router, or plugin implementation type.

## Verify before starting

- `git diff --stat 7d62e3ec..HEAD -- packages/protocol packages/client-core/src/host/registries/commands packages/client-core/src/host/palette apps/tui/src/chrome`
- `rg "type CommandContribution|executeCommand|paletteRows.register|createOverlayPalette" packages apps plugins`
- Confirm the committed manifest schema still matches the action-only contract before this phase.

