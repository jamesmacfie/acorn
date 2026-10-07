# Phase 01: protect documents from external changes

> **Follow-up completion note — October 7, 2026.** Confirmation now captures the Node, task,
> filename, document owner, edit revision, and disk snapshot when the button arms. Reload and
> overwrite refuse a newer disk revision or changed identity; recreate remains an absence-guarded
> write. The filename appears in the confirmation prompt. One reconciliation path preserves
> CodeMirror state when an explicit reload reads the current text. Recovered drafts remain blocked
> even when disk matches their saved baseline, until a confirmed resolution. Custody counts
> overlapping suspensions, and worktree/focus/reconnect bursts queue at most one active read at a
> time. Save as checks destination custody before writing and moves source recovery only after a
> successful rebind. The client lifecycle helper owns refresh scheduling, decisions, and disk
> reconciliation; the pane still owns CodeMirror updates. Later file-operation phases must release
> each suspension holder once and use the same destination preflight before path mutations.
>
> Follow-up tests cover an intervening disk edit and tab switch during confirmation, identical
> explicit reload, matching-baseline and legacy recovery through close and retirement, overlapping
> suspension holders, burst refresh, late Node switch and task eviction reads, failed read versus
> deletion, and Save as collisions before and after the write. The Editor pane's 41 focused tests,
> custody's 10 focused tests, the editor package's 122 tests, plugin API's 14 tests, and the TUI
> package's 676 tests (2 skipped) passed. Lint and architecture checks passed. Client-core had
> 2,464 passes and two failures; the same failures, plus the earlier Node golden-route and desktop
> activation snapshot failures, reproduced with narrow tests on an untouched archive of parent
> commit `bf1143d08`. This is parent-commit evidence, not a claim about unchanged main. The isolated
> desktop Recreate prompt showed the filename and retained the draft; the isolated terminal
> navigation flow passed. The desktop driver cannot automate native dialogs or child webviews.
> External writers remain outside Acorn's path locks. No full repository suite was run in this phase.

> **Completion note — October 7, 2026.** Landed revision-bearing Editor file reads and guarded
> saves, canonical-path serialization for Editor writes, custody suspension and recovery baselines,
> active and cached document revalidation, and explicit conflict, deletion, read-failure, comparison,
> reload, overwrite, recreate, and save-as flows. Existing file-list and host-document routes remain
> unchanged. A missing revision now fails closed, so an older Node requires an update before this
> Editor can save. A null revision is reserved for explicit creation; existing-file overwrites use the
> revision shown when the person confirms. Recovery records without revision metadata require a
> deliberate resolution. The Editor filesystem bridge loads on first request to keep the Node's
> service bundle within its size budget. Later file-operation phases should use the pool's narrow
> suspend/rebind/retire operations and acquire descendant locks in sorted canonical-path order.
> External CLI and terminal-editor writes remain outside these locks, so the final hash check and
> write cannot provide an atomic compare-and-swap against them. External changes without an Acorn
> worktree event become visible on focus or explicit reload.

> **Verification.** `pnpm test --filter=@acorn/plugin-editor` passed 112 tests;
> `pnpm test --filter=@acorn/node-core` passed 1,633; `pnpm test --filter=@acorn/tui`
> passed 676 with 2 skipped using the staged Node 24.21 runtime. The database, workflow, and
> plugin API suites passed together. The focused custody test passed 9 tests. The architecture
> suite and lint passed. Full client-core had 2,463 passes and two parent-baseline failures
> (workspace route classification and CSS token count). Full Node had 272 passes and one parent-baseline
> golden-route failure for terminal task setup. The desktop package suite built and ran 171 passing
> tests; 11 client activation snapshots failed on parent-baseline terminal, agents, and changes
> contributions. The isolated desktop driver showed a preserved draft,
> conflict comparison, and a deleted-file draft restored after restart; screenshots are in
> `.acorn/agent-dev/phase01-document3/screenshots/`. The isolated terminal `tui-navigation` flow
> passed; its report is under `.acorn/agent-dev/tui/phase01-tui/reports/`. The desktop driver cannot
> reach native dialogs or child webviews, so Save as and PTY behavior were checked through routes,
> focused tests, build/import gates, and the terminal driver rather than native dialog automation.

Date: October 7, 2026. Status: implemented.
Source baseline: `47f7431e72c9f239736ce63fb6774aed4f61180c`. Dependency: none.

This PRD defines disk freshness, save conflicts, and document write suspension for worktree files.
Implement it before file rename and deletion. It applies to file documents, not every plugin's write API.

## Problem and outcome

Agents and people edit the same checkout. `plugins/editor/src/client/EditorPane.tsx` reloads a clean
active document on window focus. Dirty documents skip that read. `plugins/editor/src/server/editor.ts`
writes without comparing the file with the version originally read.

A person must see external changes without leaving and returning to Acorn. A save that detects
different disk content must retain the draft and request a deliberate resolution. A missing file
must remain recoverable without an autosave recreating it.

## Starting points and owners

Inspect these files and their tests:

- `plugins/editor/src/contract/api.ts`, `plugins/editor/src/client/editorClient.ts`, and
  `plugins/editor/src/server/routes/editor.ts` own the file wire contract and transport.
- `plugins/editor/src/client/editorDocumentPool.ts` binds file saves to document custody.
- `plugins/editor/src/client/EditorPane.tsx` owns display, save scheduling, reload, and close guards.
- `packages/client-core/src/features/editor/documentCustody.ts` owns serialized writes, acknowledged
  text, formatter updates, and dirty recovery. Preserve host-document callers when extending it.
- `packages/node-core/src/server/core/fs.ts` owns path confinement. The shared diff renderer is
  described in [diff rendering](../../diff-rendering.md).

Read [saving and recovery](../../editor/save-and-recovery.md),
[the editor pane](../../editor/editor-pane.md), and [path confinement](../../security/process-and-paths.md).

## Required behavior

### Refresh documents

Revalidate the active text document on worktree invalidation, reconnect, explicit **Reload from disk**,
and window focus. Mark inactive cached files stale and revalidate before showing them. Coalesce bursts;
do not read every open file on every event or install a watcher per tab.

A successful read of unchanged text changes no selection, undo history, dirty state, or autosave.
Changed text replaces a clean buffer and clamps its cursor/scroll to the replacement. A dirty or saving
buffer retains its contents; detect disk divergence and show the conflict state after the save settles.
Discard reads that belong to a retired document, changed Node/task, or older request generation.

An unavailable Node shows a read failure while retaining useful text. Distinguish this from a missing
file. A missing file shows **Deleted on disk** and pauses ordinary writes. Offer **Save as…** into the
task root or **Recreate file…** with confirmation. Recreating requires that the path is still absent.

### Guard saves

Read a file as text plus an opaque disk revision. The revision covers the original UTF-8 bytes,
including a byte order mark and line endings. Send the expected disk revision on file saves.
Return the exact post-hook text and its revision on success, as the acknowledgement already does.

The Node compares the expected revision after before-save hooks and immediately before replacing
the file. Reject detected changes or deletion with a typed conflict result. A conflict must not enter
the ordinary autosave retry loop, including blur, pane retirement, and tab close. Keep recovery intact.

Serialize Editor-owned saves and path mutations against the canonical checkout/path, including
aliases of the same checkout. Define lock ordering for folder operations so nested files cannot deadlock.
External CLI writers do not participate in this coordination. Document the remaining filesystem race;
do not describe a hash check plus replacement as an atomic compare-and-swap against arbitrary writers.

Graphical clients must not downgrade to unguarded saving when a Node lacks revision support. Show an
actionable Node-update state and preserve recovered text. Define the mixed-version route behavior
explicitly in the API docs; do not change unrelated document routes or silently accept a missing
precondition. Keep the existing file-list contract used by agent mentions intact.

### Resolve conflicts

Show **Changed on disk** with **Compare**, **Reload from disk**, and **Overwrite disk…**. Compare the
live draft with a named disk snapshot through shared diff rendering. Opening comparison does not
save, modify, or discard either side. Refresh the comparison if its snapshot becomes stale.

Reloading a dirty draft requires confirmation. Overwrite confirms the file and uses the disk revision
shown by that decision; if disk changes again, refuse and refresh. Neither action stages a file.
Resolve ordinary save failure separately with **Retry save**. Editing remains available during a
conflict, but automatic writes remain paused until the person resolves it.

Recovered dirty text opens without an automatic write. Reconcile its acknowledged baseline with
disk on the first available read. Older recovery records remain readable; an unknown baseline requires
a deliberate resolution rather than an inferred acknowledgement.

### Prepare file operations

Provide narrow owner operations to suspend a file's save scheduling, await an admitted write, and
rebind or retire a document. Rename and deletion in phase 02 use them. Suspension must also cover
pane retirement and queued follow-up writes. Failure resumes the original usable document.

In `$EDITOR` mode, report external-editor ownership to file actions. Do not rename or trash a file
while its PTY is active. Graphical conflict handling does not claim to intercept writes made by that editor.

## Boundaries and delivery sequence

Exclude three-way Git resolution, local file history, a general filesystem watcher, and automatic merges.
Do not widen loaded-plugin filesystem access. Add shared custody behavior only for demonstrated callers.

Implement the Node revision contract and observable conflict tests first, then custody suspension and
recovery, then refresh and resolution UI. Preserve ordinary saves and formatter acknowledgements
throughout. Update the API reference, saving/recovery doc, and editor-pane doc when behavior ships.

## Acceptance and verification

Prove these behaviors with controlled writes and disposable files:

- Change disk after read, during a formatter hook, and before an explicit overwrite. Each detected
  change preserves both the draft and newer disk text, with a useful conflict result.
- Delete a dirty open file externally. Blur, close, and pane retirement do not recreate it. Explicit
  recreation refuses a path another writer created meanwhile.
- A failed read preserves text; an unchanged read preserves undo and selection; a changed clean read
  refreshes without triggering autosave. Cached tab returns and reconnects do not show stale text.
- A recovered draft opens offline, survives conflict resolution failure, and writes only after
  deliberate resolution. Test records written before revision metadata existed.
- Two Editor writes through aliased task roots serialize. Suspension joins an admitted save and
  prevents follow-up writes. Failure releases coordination and leaves the document editable.
- Formatter output remains the acknowledged body, and typing during a save stays dirty. UTF-8,
  byte order marks, and CRLF/LF round trips retain supported text behavior.
- Late reads, a Node switch, and a task eviction cannot update or write through a replacement owner.
  The database document surface and embedded editor keep their saving behavior.

Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-editor`,
`pnpm test --filter=@acorn/client-core`, `pnpm test --filter=@acorn/node-core`,
`pnpm test --filter=@acorn/tui`, and `pnpm --filter @acorn/arch-tests test`.
Run full suites for other touched contracts and consumers, including database/workflow callers if
shared custody or editor entrypoints change.

Use the [isolated drivers](../../local-development/agent-drivers.md) to verify clean reload, conflict,
compare, failed save, recovery, and deleted-file states in a desktop session. Check terminal import and
PTY ownership in a terminal session. Record screenshots, commands, and the external-writer race limit.

## Verify before building

- Trace save, follow-up save, retirement, recovery, and formatter lifetimes in the implementation checkout.
- Check read envelopes, HTTP error handling, path aliases, and mixed-version transport behavior.
- Reuse shared diff ownership and keep [Git resolution](../git-client/08-conflict-resolution.md) separate.
- Confirm worktree invalidation sources; describe which external changes are detected on focus or refresh.
