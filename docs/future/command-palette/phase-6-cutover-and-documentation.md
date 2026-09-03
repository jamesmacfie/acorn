# Phase 6: remove compatibility paths and move behaviour to its owners

Planned 2026-09-03 at `7d62e3ec`. Not started.

## Status

- Priority: P1
- Effort: medium
- Risk: medium; deletion is safe only after a repository-wide zero-use proof.
- Depends on: phases 3, 4, and 5

## Purpose

Finish the migration rather than preserving two systems forever. Remove only compatibility code with
zero consumers, run the full product gates, move all shipped behavior into owning documentation, and
retire this future folder with a precise history pointer.

## Prerequisites

- Every earlier phase's exit criteria pass on the same branch.
- Read all programme files and reconcile any amended catalogue decision.
- Capture a final repository-wide census of command registrations, palette row sources, palette item
  kinds, owner maps, private file finders, and overlay-helper consumers.

## Behavioural changes

No new feature should appear in this phase. The visible product remains exactly as phases 3–5 left
it. Only dead adapters, duplicated orchestration, stale tests, and future-only documentation leave.

## Boundaries

### In scope

- Removal of `PaletteRowSource` registry/API/adapter when its registration count is zero.
- Removal of obsolete plugin-specific palette item kinds and owner maps.
- Removal of superseded editor/GitHub private finder components and their dead slot registrations.
- Owning documentation, public plugin authoring/schema examples, tests, and future-folder retirement.

### Out of scope

- Removing the generic overlay helper while any non-command picker uses it.
- Removing the legacy loaded-manifest `palette` alias outside its documented compatibility window.
- Result action panels, query history, telemetry, styling redesign, or unrelated cleanup discovered
  during the census.

## Migration steps

1. Run `rg` and architectural tests to prove there are no `paletteRows.register` consumers. Remove
   the registry, plugin-context member/export, compatibility adapter, tests that assert the old order,
   and contribution-kind table row together.
2. Remove `PaletteItem` variants and switch branches used only for run/layout/workflow/task/workspace
   compatibility. Retain a neutral rendered-row view model owned by the session; do not expose plugin
   domain kinds to renderers.
3. Remove the old desktop and TUI ownership maps/resources if any survived the phase 1 cutover. A
   renderer may read session state and emit intents only.
4. Remove editor/GitHub finder components, slots, and tests only when their imports and registrations
   are zero. Keep `createOverlayPalette` and `PaletteSurface` APIs needed by workspace or other
   non-command pickers; narrow exports only with an import census.
5. Strengthen architectural tests:
   - one palette session implementation;
   - no host-side command composition/fetch/invoke logic;
   - no plugin-rendered palette target;
   - no loaded result action field;
   - same command graph/session package used by desktop and TUI.
6. Update owning docs:
   - `command-palette-and-shortcuts.md`: graph, hierarchy, frames, keyboard, async states, direct
     shortcuts, and focus;
   - `plugins.md` and `plugin-authoring.md`: compiled and manifest command variants with examples;
   - `contribution-kinds.md` and `plugin-map.md`: commands as the one two-tier vocabulary and removal
     of palette rows;
   - `frontend.md` and `tui.md`: shared session and host renderers;
   - `testing.md`: controller fixtures, loaded descriptors, and smoke cases;
   - relevant plugin owning docs: the commands and routes they now expose.
7. Update `packages/plugin-types/README.md`, scaffold/example manifests, and schema sync tests if their
   public command examples still show only actions.
8. Run manual smoke on desktop and TUI: root descendant search, nested back, direct shortcut, stale
   remote search, failed input retry, setting write, node switch, plugin disable/reload, Rollbar
   navigation, SQL scratch result, terminal target, and workflow launch.
9. Run all gates below. Fix only command-programme regressions; record unrelated failures rather than
   broadening the phase.
10. Once all behavior is documented and released, delete `docs/future/command-palette/`, remove its
    programme index row, and add a paragraph under `docs/future/README.md` “Retired folders” naming
    the owning documents and final invariants.

## Tests and gates

```sh
pnpm lint
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/protocol test
pnpm --filter acorn-plugin-types test
pnpm --filter @acorn/tui test
pnpm --filter @acorn/desktop test
pnpm test
```

Also run repository searches whose expected result is zero:

```sh
rg "paletteRows\.register|PaletteRowSource|paletteRowRegistry" packages apps plugins
rg "kind: 'run'|kind: 'layout'|kind: 'workflow'" packages/client-core/src/host/palette apps/tui/src/chrome
```

The second search may find domain models outside palette code; constrain or inspect every match
rather than deleting by text.

## Exit criteria

- There is one command graph, one session implementation, and no palette-row registry.
- Desktop and TUI contain rendering adapters but no independent provider/composition/invocation path.
- Every public descriptor is documented, schema-generated, runtime-validated, and covered by a
  loaded fixture.
- The legacy action form and `palette` alias remain compatible as promised.
- All automated and manual gates pass.
- The future folder is retired only after owning docs fully describe the shipped behavior.

## Rollback posture

Before release, compatibility deletions can be reverted independently. After release, a regression in
one plugin command should withdraw that registration, not restore the global palette-row system.
Keep the future folder until the product and owning docs have shipped; deleting it is the final act,
not a way to mark implementation started.

## STOP conditions

- Any repository search finds a live palette-row registration or old item-kind consumer.
- An old finder remains the target of a shortcut or slot.
- The generic overlay helper still has consumers and a proposed deletion would mix unrelated work.
- An owning document cannot state the behavior without referring back to this future folder.
- A full-suite failure cannot be shown to be introduced by the programme.

## Verify before starting

- `git diff --stat 7d62e3ec..HEAD -- docs packages apps plugins`
- Run the full census and compare every result with phases 0–5.
- Confirm all earlier phase status and exit criteria in [phases.md](./phases.md).
- Read the current API compatibility window before deleting any alias or published declaration.
- Confirm unrelated terminal-rewrite work has not been folded into command-palette changes.

