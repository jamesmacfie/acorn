# 07: EditorPane controller

> **Completion note, October 11, 2026.** `EditorPane.tsx` is 422 lines and declares no counter. The
> controller is `plugins/editor/src/client/editorController.ts`, and its tests are in
> `editorController.test.tsx`. `pnpm lint`, the arch tests, and the `@acorn/plugin-editor` and
> `@acorn/tui` suites pass on Node 26.8.1. In `pnpm dev:agent`, on a project-folder task, the pane
> opened a file, autosaved an edit, wrote on Cmd+S, took an outside change into a clean file, held a
> draft under **Changed on disk**, reloaded it after confirmation, and stepped back and forward
> between two files from the palette.
>
> What landed:
>
> - `createEditorController({ task, api, queryClient, prefs })` holds every job the pane did apart
>   from drawing: the CodeMirror mount, the pooled documents and their custody, the root read and the
>   remembered-file warm-up, saves, disk reads and file decisions, closing tabs, tab menu write holds,
>   history and reopen, terminal mode, contributed renderers, the status bar facts, and the selection
>   target. It returns signals and commands. The pane calls it once in its body, so the controller's
>   effects and cleanups belong to the pane's owner, as they did before.
> - The component keeps the sidebar, the tab strip and its menu, the banners, the status bar, the
>   palette commands, and pane intents. An `editor:reveal` intent goes to `editor.reveal()`. Search and
>   tree-reveal intents stay in the component, because they only move the sidebar.
> - Five `AbortSignal` lifetimes replace five counters, each from a small `latestSignal()` helper in
>   the controller. `surface` replaces `surfaceGeneration`, `showing` replaces `showGeneration`,
>   `navigation` replaces `navigationGeneration`, `diskRead` replaces `reloadGeneration`, and
>   `renderedRead` replaces `renderedGeneration`. Each job aborts exactly where its counter used to
>   increment, so no cancellation moved.
> - `treeRevealRevision` is gone. A tree reveal request is `{ path }`, and `FileTree` acknowledges it
>   by identity through `onRevealed(request)`. Its tests changed to match.
> - `documentRevision` stays, renamed `renderedRevision`. It's data, the `revision` a contributed
>   renderer receives with each set of props, not a staleness guard.
> - The controller tests open, edit, save, reload, confirm a reload over a draft, and step back and
>   forward, with no pane rendered. One test checks that a newer navigation aborts a pending back
>   step. I checked that it fails when `recordNavigation` stops aborting.
> - `docs/editor.md` names the two files beside its link to the pane's page. `docs/telemetry/renderer.md`,
>   the terminal client's editor alias, and two comments in the plugin name the controller where they
>   described its work.
>
> Decisions and deviations:
>
> - **Requirement 4 was already done.** Proposal 01 fixed the four status menu tests, which used a
>   stale `button:last-child` selector. The suite was green before this change started.
> - **One controller per lifetime, not one for every job.** Each lifetime has its own rule for what
>   makes it stale. A tab close can start a new `show()` without cancelling a history step, and a
>   second disk read of the same file has to cancel the first. Folding them into one signal would
>   have changed behavior.
> - **The helper is local.** Proposal 08 adds a shared multi-step helper beside `latestOnly`. It
>   should replace `latestSignal()` and keep the five call sites as they are.
> - **One module, about 1,200 lines.** The jobs share the view, the pool, and a dozen signals, so
>   splitting them would mean passing a state bag between files. Divider comments split the file into
>   sections by job. Proposal 14 can take it further if it needs to.
> - `pendingReveal` was a signal that nothing read reactively. It's a plain variable.
> - `PooledFile.markersGeneration` stays. It isn't one of the seven, and proposal 08 covers it.
>
> For later phases: the pane's async staleness checks are in `editorController.ts`. A new pane
> feature that reads or writes documents goes in the controller and gets a controller test. The pane
> only draws it.

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
