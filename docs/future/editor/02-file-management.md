# Phase 02: manage files from the tree

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `47f7431e72c9f239736ce63fb6774aed4f61180c`.
Dependency: [phase 01](./01-document-lifecycle.md).

This PRD adds create, rename, and recoverable delete actions to Editor file and folder menus.
Implement the Node operations and their document lifecycle together; a filesystem mutation alone
does not complete the feature.

## Problem and outcome

`plugins/editor/src/client/FileTree.tsx` opens files and expands folders but offers no action menu.
The editor routes list, read, and write files without exposing rename, folder creation, or deletion.
A person must manage ordinary task files from the tree using a mouse or keyboard.

## Starting points and owners

Inspect these files and their tests:

- `plugins/editor/src/client/FileTree.tsx`, `editorTreeState.ts`, and `fileTreeReveal.ts` own tree identity,
  expansion, virtualization, and reveal.
- `plugins/editor/src/client/EditorPane.tsx`, `editorDocumentPool.ts`, `editorState.ts`,
  `editorViewState.ts`, and `openFilesSlice.ts` own documents, recovery, tabs, and persisted paths.
- `plugins/editor/src/server/editor.ts`, `server/routes/editor.ts`, `client/editorClient.ts`, and
  `contract/api.ts` own confined file operations. Resolve these suffixes within `plugins/editor/src/`.
- `packages/client-core/src/kit/components/overlays/Menu.tsx` and
  `packages/client-core/src/kit/components/layout/RowActions.tsx` own menu presentation.
- `packages/node-core/src/server/core/fs.ts` owns confinement. Add a narrow Node trash adapter
  through the public service boundary if no supported adapter exists; do not call desktop APIs for remote files.

Read [interaction rules](../../ui-design/interaction.md),
[saving and recovery](../../editor/save-and-recovery.md), and [phase 01](./01-document-lifecycle.md).

## Required experience

Use the shared host menu for right-click, the row's ellipsis action, and keyboard invocation.
Opening it captures the target and leaves selection, preview promotion, and document text alone.
Restore focus to the surviving target after dismissal or successful mutation.

| Target | Actions |
| --- | --- |
| File | **Rename…**, **Copy relative path**, **Copy absolute path**, **Move to trash…** |
| Folder | **New file…**, **New folder…**, **Rename…**, both copy-path actions, **Move to trash…** |
| Tree root/empty area | **New file…**, **New folder…** |

Put the destructive action last with a separator. Expose equivalent focused-target commands in
the terminal client. Desktop right-click cannot be the only entry point. **Rename…** also supports
F2 when the tree owns focus, without intercepting editing inside a name input or external editor.

### Create and rename

Use inline naming when the row is available; use an anchored host dialog for an empty/root target.
Enter confirms and Escape cancels. Show validation and I/O failures without losing the typed name.
Accept one basename per operation, including dotfiles. Reject separators, empty names, `.` and `..`.

Create a file or folder within the selected folder, or beside a selected file through the root creation
command's explicit destination. Use exclusive creation. On success, reveal the item and open a file
as a kept tab. No operation overwrites an existing destination. Preselect a file's stem for rename;
a leading-dot basename without a separate extension selects the whole name.

Rename stays within the same parent folder. Support case-only rename according to the Node filesystem,
with recovery if an intermediate move fails. Preserve spelling and Unicode. Do not infer Git staging
or rewrite imports as a side effect.

### Move to trash

Delete means move the entry to the owning Node's system trash. Show a confirmation naming the task,
relative path, and whether a folder and its descendants are affected. Unsaved descendant drafts require
an explicit **Save and move to trash** choice or cancellation. A failed/conflicted save stops the operation.

Report trash availability from the Node. If the host or filesystem has no supported trash operation,
disable the action with an actionable explanation. Do not fall back to permanent deletion or trash on
the client machine. This release does not add a Node recovery database or a file-history browser.
Verify the supported operating systems and document remote trash limitations at handoff.

An active `$EDITOR` process on the entry or a descendant blocks rename/trash with a reason.
Cancel leaves the buffer and disk unchanged. Confirmation must suspend autosave before focus leaves
the editor; opening the menu itself has no save effect. Resume custody on cancellation or failure.

## Contracts and data flow

Use typed, task-addressed create, rename, and trash operations in the Editor wire contract.
Bind Node/task/path and entry kind at invocation. Re-derive the root on the Node, revalidate the source
and destination, and refuse stale targets. Validate new routes and keep UI mutation routes device-only.
Preserve unrelated read/write route authority.

Refuse the worktree root, Git metadata, escaped paths, and external symlink traversal. A link entry is
renamed/trashed as a link, not as its target. Do not recursively follow links inside a trashed folder.
Account for filesystem limits, permissions, cross-volume trash behavior, and partial adapter failure.
Represent a partial result honestly; never report success merely because an adapter returned no error text.

Suspend affected writers using phase 01 and await admitted writes before mutating paths. Rebind every
open descendant's custody address, save closure, undo state, view state, tab, and recovery record after
rename. Update expanded directory paths and persisted open-file identities. A late callback for the old
path cannot recreate it. A failure preserves the old document until the Node reports the actual result.

After confirmed trash, retire affected document writers and remove their tabs and persisted open paths.
Invalidate file listings, quick-open data, and Git status through the worktree event contract. Changes
then observes deletion without Editor staging it. Invalidate aliases of the same checkout; reconcile
other devices through phase 01 rather than transferring another device's unsaved draft.

Keep owner adapters compatible with [plugin resource actions](../ui-extension/04-resource-actions.md).
Reuse its public menu locations if shipped; otherwise use the shared menu privately. Do not implement
plugin action registration or file preview renderers in this phase.

## Acceptance and verification

Exercise these observable flows in disposable worktrees:

- Create a dotfile and nested-folder file, reject a duplicate name, cancel creation, and recover from
  permission failure. Reveal and kept-tab behavior work by mouse and keyboard.
- Rename clean, dirty, inactive, and preview files, then rename a folder containing several open files.
  Keep text, undo, cursor, recovery, and expanded paths; subsequent saves reach only the resulting paths.
- Case-only rename, Unicode/spaces, source disappearance, destination races, root refusal, `.git`,
  dangling links, and outside-pointing links produce the defined result without an escaped mutation.
- Trash a file and folder on a supported Node and confirm they are recoverable from that Node's trash.
  Unsupported trash, failed saves, active PTYs, cancellation, and adapter failure do not permanently delete.
- Delay a save while requesting trash/rename. No old-path follow-up write occurs after successful mutation.
  Reopen the pane and restart Acorn: renamed paths restore, trashed tabs do not reappear.
- A menu on a virtualized or inactive target does not open it. Node/task switches invalidate invocation.
  Two devices and a remote Node target the captured checkout; the client filesystem remains unrelated.

Run `pnpm lint`, full suites for `@acorn/plugin-editor`, `@acorn/client-core`, `@acorn/node-core`,
`@acorn/plugin-api`, `@acorn/tui`, changed protocol/type packages, and their consumers.
Run `pnpm --filter @acorn/arch-tests test`. Use the
[desktop and terminal drivers](../../local-development/agent-drivers.md) for the file actions and focus.
Test the real trash adapter outside mocks on each supported platform; record unavailable environments.

Update the editor-pane, core route/API, path-confinement, and any platform-service docs that own the
shipped contract. Record trash support and recovery instructions without implying permanent-delete support.

## Verify before building

- Recheck phase 01's writer suspension/rebinding and all retained path-keyed state.
- Inspect the shared menu and terminal projection before adding props or handlers.
- Verify trash API support and failure semantics on supported Nodes; refuse unsupported behavior.
- Confirm alias coordination, route gates, symlink handling, and current plugin-action locations.
