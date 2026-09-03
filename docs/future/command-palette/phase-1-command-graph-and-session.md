# Phase 1: make the graph and session the only palette brain

Planned 2026-09-03 at `7d62e3ec`. Not started.

## Status

- Priority: P1
- Effort: large
- Risk: high; this changes the focus and invocation path shared by every command.
- Depends on: phase 0

## Purpose

Implement groups and one host-neutral session controller, then reduce desktop and TUI palettes to
renderers over it. Preserve current flat rows through adapters so the state-machine cutover is not
mixed with plugin migration.

## Prerequisites

- Phase 0 is complete and all characterization tests pass.
- Read the shared key intents, `createOverlayPalette`, desktop `PaletteSurface`, TUI modal/input/row
  implementation, and the focus-restoration rules in the owning command-palette and TUI docs.
- Confirm whether terminal-rewrite changed the TUI renderer; adapt rendering only, not the session
  contract.

## Behavioural changes

- A command may be a group and static commands may name a same-owner group parent.
- Empty root shows top-level commands. A typed root query searches available descendants and displays
  their breadcrumb.
- Enter pushes a group. Escape pops to the exact parent query and selection, or closes at root.
- A shortcut targeting a group or later interactive command opens the palette at that command rather
  than trying to call a missing leaf executor.
- Existing actions, tasks, workspaces, terminal targets, workflows, and errors still appear and act
  through compatibility adapters.

## Boundaries

### In scope

- A Solid-compatible but renderer-neutral palette session in client-core.
- Desktop and TUI renderer adapters.
- Keybinding dispatch into actions versus interactive commands.
- Compatibility adapters for the current palette item model and `PaletteRowSource` results.

### Out of scope

- Query-dependent remote calls, input submission, setting writes, manifest search descriptors, and
  first-party command catalogue expansion.
- Styling outside the existing palette tokens and kit components.
- Replacing the workspace topbar picker.

## Migration steps

1. Implement the session operations defined in architecture: open root, open at command, set query,
   move selection, activate, push, pop, close, and respond to captured-context invalidation.
2. Represent root and group frames with query, selected stable ID/index, status, and a projected list.
   Popping restores the saved frame object rather than rebuilding it from global mutable state.
3. Build the root projection from the graph plus compatibility providers for current task/workspace
   rows and `PaletteRowSource` output. Keep errors non-selectable and preserve the current stable row
   order when the query is empty.
4. Update command dispatch: leaf actions execute normally; a group or interactive command asks the
   registered palette presenter to open at its frame. The keymap remains the only global dispatcher.
5. Replace state/resource/invocation ownership in desktop `CommandPalette.tsx` with a context factory,
   session instance, and view bindings. Evolve `PaletteSurface` to render breadcrumb, frame status,
   current selection, and `aria-busy` without knowing command semantics.
6. Replace the matching logic in TUI `Palette.tsx` with bindings to the same session. Its host-only
   code maps breadcrumb, rows, loading/status, and focus to terminal kit nodes.
7. Close and abort the session on external node/workspace/project/task identity changes. Ensure a
   command-driven navigation closes through its outcome before the external invalidation observer can
   present an error.
8. Add one temporary core group with two harmless test/fixture children to prove hierarchy; do not
   migrate the production catalogue until phase 3.

## Tests

Shared controller fixtures must prove:

- root ordering and descendant breadcrumb search;
- push/pop query and selection restoration over at least three levels;
- unavailable ancestors hide descendants;
- stable-ID selection preservation and index clamping;
- Escape at child versus root;
- successful, rejected, and `stay` action outcomes;
- duplicate activation suppression while an action is pending;
- external context invalidation closes once;
- opening directly at a group through a shortcut.

Run those fixtures against both desktop and TUI adapters. Add DOM assertions for combobox/listbox
roles, `aria-activedescendant`, focus restoration, and announced status. Add TUI key assertions for
the same Enter/Up/Down/Escape sequence.

Run:

```sh
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/tui test
pnpm --filter @acorn/desktop test
pnpm lint
```

## Exit criteria

- No desktop or TUI component independently composes, filters, owns, or invokes palette rows.
- The shared session passes identical transition fixtures for both hosts.
- Existing commands and compatibility rows have parity with phase 0.
- Nested groups and descendant root discovery work from palette and shortcut entry.
- Focus returns to the pre-palette target after final close, never on an intermediate pop.

## Rollback posture

Keep the old flat composition behind one short-lived host switch until desktop and TUI parity tests
pass, then remove the switch in this phase. The compatibility row adapters remain through phases 2–5.
If one host cannot represent a session field, fix the adapter or the closed kit; do not fork session
semantics.

## STOP conditions

- The implementation needs another global key listener or host-specific command registry.
- TUI rendering requires a different push/pop or selection rule.
- Context capture requires reading plugin-owned state from core.
- A current command can no longer be invoked outside the palette by its shortcut.

## Verify before starting

- Re-run all phase 0 characterization tests.
- Search for new palette/session work added since the plan and reconcile rather than duplicate it.
- Confirm desktop and TUI still use the same keymap intents and only differ at rendering.
- Confirm the list of current palette row kinds and sources has not expanded.

