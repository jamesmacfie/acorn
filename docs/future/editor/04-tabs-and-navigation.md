# Phase 04: manage tabs and navigate files

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `47f7431e72c9f239736ce63fb6774aed4f61180c`.
Dependency: [phase 03](./03-git-status.md).

This PRD defines tab actions, recent quick open, file-position input, and navigation history.
Implement these through Editor's document owner and the shared command palette.

## Problem and outcome

Editor tabs show basenames, so several `index.ts` files look alike. Tabs close individually and promote
previews, but lack bulk close and reopen. Quick open starts with Git listing order, and navigation
has no return path after a search result or cross-pane file reference.

A person must recognize open files, reduce tab clutter, reopen a closed file, and return to a previous
reading position. These operations must preserve dirty text and identify the correct Node/task/file.

## Starting points and owners

Inspect these files and their tests:

- `plugins/editor/src/client/editorState.ts`, `openFilesSlice.ts`, and `editorViewState.ts` own tab
  lists, persisted open state, and cursor/scroll. Resolve these suffixes within the Editor client folder.
- `plugins/editor/src/client/EditorPane.tsx` owns guarded close, preview promotion, and file reveal.
- `plugins/editor/src/client/commands.ts` owns quick open and whole-path fuzzy ranking.
- `packages/client-core/src/kit/components/layout/DocumentTabs.tsx` is shared with terminal sessions.
- `packages/client-core/src/host/registries/commands/clientEvents.ts` owns retained pane intents.

Read [state scope](../../state-ownership/scope-rules.md),
[palette commands](../../command-palette-and-shortcuts/commands.md), and
[saving and recovery](../../editor/save-and-recovery.md). Keep unrelated DocumentTabs consumers compatible.

## Required experience

### Tab labels and menus

Keep a basename label when it is unique. For duplicate basenames, append the shortest parent-path
suffix that distinguishes all open copies. The tooltip retains the full relative path. Recompute
labels after opening, closing, or renaming files without changing document identity.

Use the shared menu on each tab, including keyboard invocation. Target that tab without activating it.
Provide these actions:

- **Keep open** for a preview, plus the established double-click promotion.
- **Close**, **Close others**, **Close to the right**, and **Close all**.
- **Copy relative path**, **Copy absolute path**, and **Reveal in file tree** for that target.

Bulk close captures the ordered set of target paths. Close each through the document owner's guard;
do not remove entries directly from the list. Stop on a failed/conflicted save or intervening edit,
leave the affected and unprocessed tabs open, and report any already-closed tabs as a partial outcome.
Tabs opened after invocation are not included. Preserve keyboard focus on a surviving tab or document.

Register **Reopen closed file** in the palette and bind Cmd+Shift+T on macOS/Ctrl+Shift+T elsewhere
only while the editor owns focus. The terminal drawer's separate chord remains unchanged.
Track the last 20 successful explicit closes per Node/task for the session. Preview replacement,
trash, and failed close do not enter the stack. Reopen a kept tab at its recorded position.

If a closed file disappeared, show the reason and permit the next reopen attempt to reach the next
entry. Do not create an empty file. Reopen does not promise undo history after a successful close;
dirty recovery remains custody's responsibility. Keep only path/position metadata in the close stack.

### Recent quick open and position input

For an empty quick-open query, list recent valid files first, then the repository listing without
duplicates. Track at most 50 recently activated paths per Node/task on this device. Restore that
bounded metadata across app restarts using the documented device-scope mechanism; do not put it in
global preferences or change persisted open-tab ownership.

Preserve whole-path fuzzy ranking for nonempty queries. Accept `path:line` and `path:line:column`
with positive one-based integers. Picking the result opens the file as a preview and places the cursor
at the clamped position through the retained Editor reveal intent.

Resolve an exact listed filename before interpreting a suffix, so a literal colon-bearing filename
is still openable. Without an exact path match, remove a valid numeric suffix before fuzzy ranking.
An invalid suffix remains ordinary query text. Never let a parsed suffix change filesystem authority.
Capture Node/task when the palette session begins and reject selection after that context changes.

### Back and forward

Register **Go back in editor** and **Go forward in editor** as focused Editor commands. Use
Alt+Left/Alt+Right when available through the host keymap, with platform overrides supported.
Do not intercept text-selection, browser-native, or PTY keys through a window listener.

Keep up to 100 navigation locations per Node/task for the session. A location contains relative path,
cursor position, and scroll. Record deliberate file switches and jumps from search, quick open,
go-to-line, and cross-pane references. Ordinary typing, cursor movement, and background refresh do
not create entries. Consecutive identical locations coalesce.

Back/forward replays a location without creating another entry. A fresh navigation after going back
discards the forward tail. Clamp positions after external edits. Skip unavailable/deleted targets with
a visible explanation; never recreate them or switch Nodes/tasks to replay a stale location.
Phase 02 rename updates matching history/MRU paths, and trash removes their navigable references.

## Architecture and boundaries

Editor owns history, recency, and close metadata beside its state. Document custody owns text and saves.
The kit supplies optional tab-menu presentation/slots only; it must not learn filesystem or Editor rules.
Use the command registry and retained intents instead of a second palette, shortcut handler, or event bus.

Scope all records by Node and task, evict session history with its owner, and dispose subscriptions.
Bounded device recency must be explicitly pruned on archive. Update the relevant state-ownership doc
with the storage address and limit. Preserve existing open-tab persistence and recovery records.

Exclude tab drag/reorder, split editor groups, project symbol indexing, and cross-task history.
Use [plugin resource actions](../ui-extension/04-resource-actions.md) if its tab target contract has shipped;
otherwise keep the menu adapter private and preserve its planned canonical identity.

Implement labels and guarded tab actions first, then close history/recency, then position parsing and
navigation. Update the editor-pane, palette, and state-ownership reference docs as each behavior ships.

## Acceptance and verification

Prove these user flows:

- Open repeated basenames across several nested folders. Labels distinguish them after tab close and
  folder rename. An inactive tab menu copies/reveals/closes that tab without activating another file.
- Bulk-close a mix of clean, dirty, saving, and conflicted files. Delayed saves, edits during close,
  cancellation, and failure keep the correct tabs. Files opened during the operation survive.
- Reopen success, deletion, successive closes, repeated reopen, and preview replacement obey the stack
  rules. Close metadata stores no text or duplicated document state.
- Empty quick open shows recent files once; nonempty whole-path ranking retains its behavior. Restart,
  Node switches, equal task IDs, archive, and missing paths cannot leak recency between scopes.
- Open `src/a.ts:12:4`, clamp an oversized location, preserve literal colon filenames, and reject
  selection from a retired palette context. Preserve bounds and lazy file loading.
- Jump from a search hit and a cross-pane reference, go back and forward, then branch the history.
  Typing, refresh, and replay do not fill the stack. Rename/delete reconcile it without hidden saves.
- Desktop and terminal keys work through the host. Shared terminal-session tabs keep close, activation,
  status, and focus behavior without receiving Editor-only menu actions.

Run `pnpm lint`, full suites for `@acorn/plugin-editor`, `@acorn/client-core`, `@acorn/plugin-api`,
`@acorn/tui`, touched protocol/persistence packages, `@acorn/plugin-terminal` if shared tabs change,
and their consumers. Run `pnpm --filter @acorn/arch-tests test`.
Use [isolated drivers](../../local-development/agent-drivers.md) to verify inactive tab menus, failed bulk
close, quick open, and navigation on both hosts. Record screenshots, snapshots, and key routing.

## Verify before building

- Inspect current close guards, palette session Node binding, and persisted state scope.
- Check shared tab consumers and host shortcut conflicts before extending the kit or assigning chords.
- Confirm phase 02 path mutation notifications can update metadata without reaching another device's draft.
- Recheck state storage/eviction contracts and keep bounded metadata separate from document custody.
