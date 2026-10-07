# Keep the editor programme focused

Date: October 7, 2026. Status: scope decisions for proposed requirements; implementation not started.

This page records what the editor usability programme excludes and why. Read it before expanding
a phase. These decisions keep everyday editing useful without requiring Acorn to maintain a full IDE.

## Leave advanced code tooling to separate work

Language servers, project symbol indexing, semantic refactoring, diagnostics, debugger integration,
and inline AI completion need separate product and process-lifecycle decisions. None is required to
create, rename, delete, inspect, or navigate a file.

Shared inline find/replace controls belong to [Find in file](../find-in-file.md). Plugin document
intelligence belongs to [the UI extension programme](../ui-extension/09-document-intelligence.md).
Do not duplicate either to make an editor phase appear complete.

## Keep Git writes in their owner

Editor does not stage, commit, discard Git changes, or continue operations. Changes and the planned
Git client own those actions. The editor's disk-versus-draft comparison is separate from
[three-way Git resolution](../git-client/08-conflict-resolution.md).

Do not use `git checkout`, `git restore`, or reset as a file-delete implementation. They can restore
tracked bytes and permanently remove unrelated untracked work with semantics different from trash.

## Defer broader file management

Duplicate, move-to-folder, drag-and-drop, multiselect filesystem actions, and filesystem operation
undo remain later work. Rename in phase 02 stays within the parent directory. These broader actions
need destination and collision behavior, descendant custody transfer, partial results, and tests.
Create/rename/trash addresses the reported friction first.

Permanent deletion is excluded. On Nodes where system trash is unsupported, report that limitation
instead of deleting irreversibly. A portable Node recycle store is a separate decision with storage,
retention, capacity, restart recovery, and archive/backup consequences. This programme does not add it.

## Defer complex reading layouts

Split editor groups, tab dragging, minimaps, sticky tree ancestors, compact folder chains, project
breadcrumbs, and automatic reveal on every activation add presentation and focus behavior. Manual
reveal, distinct tab names, scoped search, and navigation history provide the required navigation.

Plugin previews and custom file renderers remain in [Editor file viewers](../editor-files.md).
This programme preserves their identity/control boundaries but does not implement their contributors.

## Avoid implicit document rewrites

EditorConfig support, whole-file indentation conversion, encoding conversion, automatic trailing
whitespace cleanup, and mandatory final newlines remain deferred. Indentation settings guide subsequent
edits; they do not rewrite a file on open or save. Format-on-save belongs to the established plugin hook.

Persistent local file history is also deferred. Dirty recovery protects unsaved text; system trash
provides the chosen delete recovery. A history store needs its own retention and privacy requirements.

## Verify before building

- Confirm the separate find, file-viewer, UI extension, and Git plans before adding overlapping behavior.
- Report an excluded requirement as a separate proposal instead of hiding it inside a phase.
- Revisit a deferral when a demonstrated workflow needs it, with its owner and lifecycle costs stated.
