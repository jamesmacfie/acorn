# Phase 05: expose editing controls and state

> **Completion note — October 8, 2026.** Editor now presents relative path, cursor position,
> language, inferred or chosen indentation, nonempty aggregate selection length, and custody save
> state in a compact strip. The path has explicit copy and tree reveal actions. A narrow strip hides
> secondary facts in Details while retaining position and save state. Save failure keeps its detailed
> banner and offers Retry save through custody; changed or deleted disk content and recovered drafts
> keep their existing resolution actions. PTY and read-only previews show only facts they own.
>
> Word wrap defaults off at device scope and can be overridden per open document for the session.
> A CodeMirror compartment reconfigures the admitted graphical document without changing text or
> its undo history. Indentation uses the first 200 lines and at most 64 KiB, preferring consistent
> two-, four-, or eight-space steps or tabs; ambiguous samples use the device default of two spaces.
> Manual mode and width affect subsequent indentation and tab display only. Presentation overrides
> follow successful folder or file rename and are pruned with their task or Node. Focused host
> commands use the live admitted document for find, replace, line operations, comment, next match,
> undo/redo, and indent/outdent. Go to line retains the phase 04 command and history path. The
> shared find panel is still future work, so these commands invoke CodeMirror's search panel.
> The engine remains lazy and the kit has no CodeMirror dependency.
>
> **Verification and limits.** The Editor suite passed 178 tests (1 skipped); TUI passed 682
> (2 skipped), protocol 294, plugin API 14, architecture 87, and lint passed all 37 tasks. Client
> core passed 2,468 and retained its known workspace-route and CSS shadow-token failures. One
> telemetry test failed only in an earlier concurrent package run and passed in a focused rerun;
> the final package run had only the two known failures. The isolated desktop build showed a clean
> Saved file, recovered draft, inferred indentation, and checked Word wrap with visibly wrapped
> JSON lines. An external disk edit produced a real Changed on disk conflict and preserved the
> local draft. The live save-failure banner was not induced; custody and pane tests cover failure
> and retry. Final screenshots in `.acorn/agent-dev/phase05-controls/screenshots/` show the strip
> at a narrow width in dark and light themes (`status-narrow-final.png`, `status-light-final.png`),
> wrapped text (`wrapped-final.png`), and the focused palette command
> (`palette-focused-final.png`). TUI built with all 49 runtime imports resolved and rendered at
> 80×24 and 120×40; its editor detail was exercised by the TUI package suite. The final unfiltered
> repository gate remains with the coordinator after phase 06.

Date: October 7, 2026. Status: completed October 8, 2026.
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
