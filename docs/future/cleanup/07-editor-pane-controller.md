# 07: EditorPane controller

This proposal splits the editor pane into a plain controller and a Solid component. It replaces
seven hand-rolled staleness counters with one cancellation per navigation.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md).

## Problem

`plugins/editor/src/client/EditorPane.tsx` is 1,449 lines in one component function, the largest
hand-written file in the repository. Its body holds about 20 mutable `let` variables and 38 signals,
memos, and effects. Seven of the variables are counters that guard against a stale async result
overwriting a fresh one: `surfaceGeneration`, `navigationGeneration`, `showGeneration`,
`reloadGeneration`, `renderedGeneration`, `documentRevision`, and `treeRevealRevision`.

The component mixes four jobs:

- The CodeMirror view lifecycle: mount, per-file extensions, wrap and indentation compartments,
  focus.
- Document custody: the pooled file, dirty state, saves, disk reads, reloads, and recovery.
- Navigation: open, reveal, back and forward replay, and pane intents.
- Layout and the status bar.

Four tests in `plugins/editor/src/client/EditorPane.test.tsx` have failed since at least October
10. They cover the file status menu and wrap and indentation changes. Each later editor change worked
around them instead of fixing them, which is what a file this hard to change produces.

## Goal

The component draws and binds. A controller owns the view, custody, and navigation, and tests can
drive it without rendering the pane.

## Requirements

1. Add an editor controller module in `plugins/editor/src/client/`. It owns the CodeMirror view, the
   document pool interaction, disk reads, saves, and navigation. It exposes signals for what the
   component draws.
2. Give each navigation one `AbortController`. Abort the previous one when a navigation starts, and
   check the signal instead of comparing counters. Delete the counters that this replaces.
3. Keep the component to layout, the status bar, menus, and wiring the controller to the pane's
   props and lifetime.
4. Fix the four failing tests as part of the move, or before it if the cause is independent.
5. Keep behavior the same on both hosts, including the terminal client's external editor path.

## Acceptance

- `EditorPane.tsx` is under 500 lines and declares no generation counter.
- The controller has tests that open, edit, save, reload, and navigate without rendering.
- `pnpm test --filter=@acorn/plugin-editor` passes with no failing case.
- In `pnpm dev:agent`, open, edit, save, an external change, and back and forward navigation behave
  as before.
