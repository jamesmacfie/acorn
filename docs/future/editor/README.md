# Improve everyday editor use

Date: October 7, 2026. Status: phases 01–06 implemented on October 8, 2026; combined release acceptance and the integrated full test gate remain pending. See [phase 06 evidence](../../testing/editor-phase06-2026-10-08.md).
Source baseline: `47f7431e72c9f239736ce63fb6774aed4f61180c`.

This programme adds everyday file management, change visibility, navigation, and editing controls
to Acorn's editor. Give each phase's product requirements document (PRD) to the developer implementing
it. Each PRD includes its starting points, requirements, boundaries, and acceptance checks.

## Product goal

A person can inspect agent changes, make a small edit, manage files, and return to their task
without opening another editor or using a terminal for routine file operations. Keep the editor
small: CodeMirror owns graphical text editing, Editor owns file documents, and Changes owns Git writes.

The primary workload is a large application repository such as Runn, with nested folders, repeated
filenames, generated files, and agents editing the same checkout. Support local and remote Nodes.
File actions and navigation also work in the terminal client; graphical editing remains CodeMirror
on desktop and the established `$EDITOR` handoff in the terminal.

## Execute the phases

Implement the phases in numerical order. Phase 01 provides the write and document lifecycle rules
that file actions depend on. Phase 02 delivers the immediate user request: right-click rename and delete.
Complete each phase's acceptance before beginning the next. Do not create a branch or delegate
without the user's request.

| Phase | PRD | Outcome | Dependency |
| --- | --- | --- | --- |
| 01 | [Protect documents from external changes](./01-document-lifecycle.md) | Disk revisions, conflict handling, freshness, and safe suspension of writes. | None |
| 02 | [Manage files from the tree](./02-file-management.md) | Create, rename, and move to trash through accessible file and folder menus. | 01 |
| 03 | [Show Git status beside files](./03-git-status.md) | File colors and badges, folder summaries, and resilient status refresh. | 02 |
| 04 | [Manage tabs and navigate files](./04-tabs-and-navigation.md) | Tab menus, reopen, distinct labels, recent quick open, position suffixes, and navigation history. | 03 |
| 05 | [Expose editing controls and state](./05-editing-controls.md) | File status, word wrap, indentation settings, and discoverable engine commands. | 04 |
| 06 | [Scope search and finish acceptance](./06-search-and-acceptance.md) | Folder search, include/exclude patterns, tree controls, and combined verification. | 05 |

[Scope boundaries](./refused.md) records deferred functionality and its reasons. These phases cover
the recommended usability pass. Duplicate, move-to-folder, drag-and-drop, and persistent local history
remain later work.

## Ownership and invariants

Trace a file action from its captured UI target through the Node route, confined worktree access,
document custody, query invalidation, and the updated tree or tab. Use these owners:

- `plugins/editor` owns worktree file operations, open tabs, tree, quick open, and project search.
- `packages/client-core/src/features/editor/` owns shared graphical editing and document custody.
- `packages/client-core/src/kit/` owns controls and their keyboard/accessibility behavior.
- `plugins/changes` owns Git status semantics and Git mutations. Editor consumes a narrow status
  contract and does not import Changes' private client model or invoke its routes directly.
- The Node owns filesystem authority. Device code passes a task and a case-preserving relative path;
  it does not choose an absolute root. Capture Node identity before asynchronous work.

Use one document owner per Node/task/path and one acknowledgement of the text actually saved.
Keep dirty recovery, undo state, formatter acknowledgements, preview promotion, lazy grammars,
tree virtualization, and terminal import boundaries. Shared checkout aliases need coordinated
Node file operations even when their task IDs differ.

Opening a context menu must not open, save, promote, or close its target. A menu on an inactive tab
targets that tab. Destructive actions use host confirmation. Do not silently overwrite a destination,
recreate a removed file, discard dirty text, stage a file, or permanently delete as a trash fallback.

## Coordinate related programmes

These editor improvements do not depend on [plugin file viewers](../editor-files.md). Keep canonical
Node/task/path identity and tab controls usable when a renderer replaces the document area.

[Plugin resource actions](../ui-extension/04-resource-actions.md) and
[file annotations](../ui-extension/07-file-annotations.md) extend these same owners. Built-in menus
and Git status can ship without those phases. If their public locations or points have shipped,
reuse them; otherwise keep owner adapters private. Do not create a competing menu registry or
publish a second annotation protocol to deliver built-in behavior.

[Find in file](../find-in-file.md) owns the shared inline find/replace controls. Phase 05 exposes its
commands but does not redesign that panel. [Git conflict resolution](../git-client/08-conflict-resolution.md)
owns three-way merge/index resolution. Phase 01 compares an Editor draft with disk and performs no
Git staging or operation continuation.

## Verify and hand off

Read [Editor](../../editor.md), [saving and recovery](../../editor/save-and-recovery.md),
[interaction rules](../../ui-design/interaction.md), [state scope](../../state-ownership/scope-rules.md),
[path confinement](../../security/process-and-paths.md), and [testing](../../testing.md).
Follow [conventions](../../conventions.md) for file placement and typed public contracts.

Use focused tests while implementing. At each handoff, run `pnpm lint`, full tests for touched packages
and their consumers, and `pnpm --filter @acorn/arch-tests test`. Every phase lists its minimum package
scope. Run `pnpm test` once after phase 06 is integrated and package checks pass.

Verify UI changes with the [isolated app drivers](../../local-development/agent-drivers.md). Use a
disposable repository, snapshot after each screen change, inspect screenshots, and stop both sessions.
Record the fixture, Node/runtime, commands, results, host evidence, and limitations. A test mock does
not prove trash support, keyboard routing, remote targeting, or graphical appearance.

Update the owning shipped docs in each implementation phase. Keep these PRDs as requirements until
acceptance is complete, then update their status and link dated delivery evidence. Do not describe
proposed behavior as shipped in the reference docs.

## Research basis

The useful conventions are accessible file operations, contextual Git status, and navigation that
does not require a project language service. Research reviewed on October 7, 2026:

- [VS Code Explorer](https://code.visualstudio.com/docs/editing/getting-started/userinterface)
  documents create, rename, delete, and contextual file actions.
- [Zed project panel](https://zed.dev/docs/project-panel) documents inline naming, recoverable trash,
  preview tabs, reveal, and Git decorations, including limits on remote trash support.
- [Sublime Git integration](https://www.sublimetext.com/docs/git_integration.html) documents file badges,
  folder summaries, and muted ignored files.
- [VS Code editing](https://code.visualstudio.com/docs/editing/codebasics) documents scoped search,
  indentation, and common text operations.
- [Cursor migration](https://docs.cursor.com/get-started/migrate-from-vs-code) explains its shared
  VS Code editor foundation.

## Verify before building

- Compare the implementation checkout with the baseline and re-read each phase's named owners.
- Check which related programmes have shipped and adapt private integration details to those owners.
- Confirm Node support, trash availability, host key routing, and current package test commands.
- Treat paths as starting points. Preserve requirements when ownership moves; report a conflicting
  public contract before introducing a parallel one.
