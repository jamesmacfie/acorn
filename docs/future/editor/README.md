# Finish editor acceptance

Date: October 8, 2026. Status: all six phases implemented; final review and release acceptance remain open.

Use this handoff to review and verify the implemented editor. The phase requirements were removed
after implementation; Git history keeps them. [Completion records](../../testing/editor-delivery-2026-10-08.md)
preserve dated delivery notes. [Editor](../../editor.md) owns the behavior and contracts.

## Starting point

Document conflicts, create/rename/trash, Git marks, tab actions, navigation history, editing controls,
and scoped search are implemented. The shared [find panel](../../editor.md#find-in-a-file) is implemented too.
[Phase six evidence](../../testing/editor-phase06-2026-10-08.md) and
[its followup](../../testing/editor-phase06-follow-up-2026-10-08.md) record package results,
local connected acceptance, and checks that could not run.

The checkout contains the implementation. Review of the combined change and the unfiltered test gate
remain open in the dated handoff. Confirm integration against the target revision before
assigning further implementation. A passing phase suite does not close the final gate.

## Review the owners and contracts

Trace file actions from the captured Node/task/path through confined filesystem access, document
custody, recovery, invalidation, and tree/tab reconciliation. Start with these owners:

| Owner | Responsibility |
| --- | --- |
| `plugins/editor` | File routes, tree, open tabs, quick open, navigation, and scoped search. |
| `packages/client-core/src/features/editor/` | Shared graphical editing and document custody. |
| `plugins/changes` | Git status semantics and Git writes. Editor consumes the narrow file-status contract. |
| `packages/client-core/src/kit/` | Controls, menus, focus, and viewport presentation. |

Review overlapping saves and file operations, destination collisions, late Node responses, tab
replacement, external writers, and dirty recovery. Preserve one document owner per Node/task/path.
Do not infer disk safety from Git status or recreate an obsolete path after rename or trash.

Keep the editor small. [Scope boundaries](./refused.md) owns excluded functionality.
[File viewers](../editor-files.md), [plugin actions](../ui-extension/04-resource-actions.md),
[file annotations](../ui-extension/07-file-annotations.md), and
[Git merge resolution](../git-client/08-conflict-resolution.md) remain separate implementation plans.

## Close the repository gate

Read the dated evidence before rerunning checks. Use the supported runtime and run:

1. `pnpm lint`.
2. Owner and consumer suites for any review fix. The affected owners include Editor, client-core,
   Node core, Node app, Changes, plugin API, protocol, desktop, and TUI.
3. `pnpm --filter @acorn/arch-tests test`.
4. The unfiltered `pnpm test` after integration and package checks pass.

Record the tested commit, runtime, commands, failures, and resolutions. Reproduce a claimed baseline
failure against that baseline; a dated failure count cannot justify ignoring a failure on another revision.

## Finish platform acceptance

The local connected flow and measurements are recorded in the phase six followup.
Remote Nodes, Linux/Windows native hosts, native dialogs and menus, and child webviews were unavailable.
Verify those paths on supported environments, or record a deliberate supported-host limitation.

Use disposable local and remote repositories with repeated basenames, ignored build outputs, large
text, images, dirty drafts, and staged, unstaged, and conflicted paths. Retain the reproducible
10,000-path fixture from the evidence when checking request and rendering bounds.

Check this connected flow in the environment under review:

1. Open a recent file and a `path:line:column` target; edit, wrap, indent, find, and save.
2. Change disk externally while clean and dirty. Compare and resolve the conflict, reconnect,
   and reopen a cached document.
3. Create, rename a dirty file, rename its parent, and trash a saved file. Exercise unsupported
   adapters, native Save as, and a failed mutation without losing draft text.
4. Read Git marks and folder summaries, then disable the provider and continue opening files.
5. Scope and filter search; follow a result, go back/forward, bulk close, and reopen a file.
6. Restart with renamed tabs and recovered text. Switch Nodes with overlapping task IDs and archive
   a task; verify isolation, focus, and cleanup.

Use [isolated drivers](../../local-development/agent-drivers.md). Inspect desktop narrow/wide widths
and light/dark appearance, plus terminal 80-by-24 and 120-by-40 frames. Use a native driver or manual
check where the desktop driver cannot reach a dialog, menu, or child webview. Stop the sessions.
Record unavailable checks explicitly.

On the large fixture, record task/search request counts, Git subprocess counts, file-open latency,
loaded tree rows, and retained history/recency bounds. Compare measurements on the same machine
when a review fix changes performance. Do not claim a baseline comparison that was not run.

## Complete the handoff

Close this programme after the combined review, full repository gate, and supported platform checks pass.
Describe accepted platform limits in the owning reference docs and dated evidence.
Delete this remaining acceptance folder when those records have an owning home.

## Verify before building

- Confirm target integration and open checks against the dated completion records.
- Read saving, navigation, file-status, search, and platform contracts before fixing a reproduced issue.
- Recheck trash and rename availability on the owning Node, including its packaged helper.
- Keep plugin viewer and extension work separate from closing implemented editor acceptance.
