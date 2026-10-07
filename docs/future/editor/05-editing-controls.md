# Phase 05: expose editing controls and state

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `47f7431e72c9f239736ce63fb6774aed4f61180c`.
Dependency: [phase 04](./04-tabs-and-navigation.md).

This PRD defines a compact file status strip, word wrap, indentation controls, and discoverable
editing commands. Reuse CodeMirror's commands and state rather than adding another editing engine.

## Problem and outcome

Editor shows a dirty dot and error banner but provides little detail about the active document.
CodeMirror's `basicSetup` supplies common text operations, while Acorn exposes few of them in menus
or the palette. A person must identify their position and save state, wrap long lines, and use the
file's indentation without knowing CodeMirror's default shortcuts.

## Starting points and owners

Inspect these files and their tests:

- `plugins/editor/src/client/EditorPane.tsx` assembles per-file extensions, tracks selection/custody,
  schedules saves, and draws document actions.
- `plugins/editor/src/client/editorEngine.ts` preserves the lazy engine boundary.
- `plugins/editor/src/client/editorPrefs.ts` demonstrates device preferences.
- `packages/client-core/src/features/editor/DocumentSurface.tsx`, `embed.ts`, and `public.ts` own
  other graphical callers and the compiled editor entrypoint.
- `packages/client-core/src/features/editor/language.ts` and `theme.ts` own languages and appearance.

Read [Editor](../../editor.md), [document custody](../../editor/save-and-recovery.md),
[shortcuts](../../command-palette-and-shortcuts/shortcuts.md), and
[inline find requirements](../find-in-file.md). That separate PRD owns the shared find/replace panel.

## Required experience

### File status

Add one compact strip below the active document, using kit components and role tokens. Show the
relative path, one-based line/column, language name, indentation mode/width, and save state.
Show selection length only for a nonempty selection; aggregate selected characters across multiple
selections without claiming that all selected text is contiguous.

Use these save states from custody: **Saved**, **Unsaved**, **Saving…**, **Save failed**, and the
phase 01 conflict/deleted states. A successful acknowledgement may say **Saved** only when no later
edit remains. The strip's **Retry save** uses the owner, and conflict actions retain phase 01 semantics.
Keep the error banner for useful failure detail rather than squeezing a sentence into the strip.

The path copies on an explicit action and offers **Reveal in file tree** through the same owner
command as tab menus. Do not add project breadcrumbs or symbol navigation. At narrow widths,
truncate the path first and group secondary details in a menu. Preserve position and save state.
Announce failures/conflicts without announcing every cursor move to screen readers.

Image/custom viewers omit text position and indentation. Show **Read-only preview** where appropriate.
An active PTY shows **External editor** and does not invent cursor or save state. Terminal mode uses
the same available file facts without constructing CodeMirror state.

### Word wrap

Expose **Toggle word wrap** in the focused Editor palette/menu and through an overridable host chord.
Persist a device-level default, off initially. A per-tab session override survives tab switches and
pane remounts; it does not modify text or Node preferences.

Use CodeMirror's supported wrapping extension through reconfiguration. Preserve undo, selection,
scroll reading position, search state, language, markers, and save listeners. Do not rebuild the
document for a presentation toggle. Wrapping applies to graphical text, not image, custom preview,
or PTY content. Keep the option unavailable when no text editor owns the document.

### Indentation

Show **Spaces: N** or **Tabs: N**. On first load, infer mode/width from a bounded sample of at most
200 lines and 64 KiB. Recognize common space widths two, four, and eight and leading tabs. Ambiguous
or unindented text falls back to two spaces. Document and test the inference examples rather than
adding a project scanner or statistical dependency.

Allow explicit per-document mode and width through the status control. Use the device default when
inference is inconclusive; retain a session override through remount and phase 02 rename. Changes
affect subsequent indentation and tab display, not the file's existing whitespace.

Expose **Indent selection** and **Outdent selection** through the engine. Preserve accessible Tab
navigation; this phase does not unconditionally capture Tab as indentation. Do not silently convert
indentation, trim trailing whitespace, normalize line endings, or add a final newline on save.
EditorConfig parsing and whole-file conversion remain deferred.

### Editing commands

Register focused graphical commands for **Find**, **Replace**, **Go to line…**, **Toggle comment**,
**Duplicate line**, **Move line up**, **Move line down**, **Select next occurrence**, **Undo**, and **Redo**.
Include availability checks for editable/read-only text and undo state. Route to the admitted active
document, not a view captured before a tab or Node switch. Go-to-line participates in phase 04 history.

Use installed CodeMirror operations and preserve their transaction/undo behavior. Keep established
engine chords when they do not conflict with host commands. Add readable labels to palette/shortcut
discovery through the established host APIs. Do not add a second global keymap or a bespoke search panel.

If [Find in file](../find-in-file.md) has shipped, invoke its shared panel. Otherwise invoke the engine's
search/replace commands and leave its control redesign to that PRD. Do not claim language-service
completion, semantic rename, diagnostics, or format-on-save as part of this phase.

## Architecture and boundaries

Editor owns the file strip and per-tab presentation overrides. Shared editor integration can own a
small reusable command/extension adapter when another graphical caller needs it. The kit remains
independent of CodeMirror. Declare direct engine package dependencies when required; do not rely on
transitive package resolution or eagerly import the engine through command registration.

Keep save state derived from custody. Do not create another mutable dirty/saving model. Register and
dispose commands with the admitted mount; availability must follow file/view changes. Use documented
device storage for defaults and document their scope in the reference docs.

Implement status first, then extension reconfiguration/preferences, then command discovery. Update
the editor-pane, keyboard, and state-ownership docs. Shared editor callers change only where a real
consumer requires the adapter, with their read-only and embedded `onChange` semantics preserved.

## Acceptance and verification

Prove these behaviors:

- Position, selection totals, language, and save state follow the active file. Delayed acknowledgement,
  subsequent typing, failure, recovery, conflict, and deletion report the correct state.
- Toggle wrap repeatedly during typing, search, and tab/task remounts. Text, undo, selection, markers,
  listeners, and custody remain valid, and no save is triggered solely by changing the option.
- Infer two/four/eight spaces, tabs, mixed, empty, and large files within the sample limit. Manual
  overrides affect subsequent editing without rewriting unrelated whitespace or line endings.
- Invoke every exposed command through the palette, including read-only and no-file states. Text
  edits reach normal autosave and undo, and selection commands do not cause writes.
- Narrow panes, long paths, multiple selections, light/dark appearances, and screen-reader names
  remain usable. Terminal/image/PTY modes show only facts their owners supply.
- The database document surface, embedded workflow editor, and terminal imports keep their behavior.
  Commands registered before the engine loads do not download it until a graphical document is admitted.

Run `pnpm lint`, full suites for `@acorn/plugin-editor`, `@acorn/client-core`, `@acorn/plugin-api`,
`@acorn/tui`, affected preference/protocol packages, and consumers. Include database and workflow
suites if shared editor entrypoints change. Run `pnpm --filter @acorn/arch-tests test`.
Use [isolated drivers](../../local-development/agent-drivers.md) to capture the strip in normal, failed,
conflict, narrow, and wrapped states, and verify palette focus/keyboard behavior. Record the sample limit.

## Verify before building

- Inspect installed engine commands, key scopes, reconfiguration, and `basicSetup` behavior.
- Check whether the inline-find PRD has shipped and reuse its search owner.
- Recheck device preferences, active custody, custom viewer admission, and terminal alias boundaries.
- Confirm supported pane widths and accessible status semantics before adding kit props.
