# Saving and recovery

This page covers who writes a document, what a save acknowledgement carries, how unsaved text
survives, and exporting a host document. It's part of [editor](../editor.md). The custody code is in
`packages/client-core/src/features/editor/documentCustody.ts`.

## Save acknowledgements and recovery

Each file has one write owner, keyed by Node, task, and path. A host document region is keyed by
Node, scope kind, scope ID, URI, and its declared routes. A document admits one write at a time.
Repeated flushes join that write, and later edits wait in one follow-up slot. Separate documents save
separately. A clean document skips the request, its hooks, and its invalidation.

The file write response carries optional `text` and `revision` fields beside `ok` and `reason`. `text`
is the exact body written after the before-save hook, and `revision` is its SHA-256 over UTF-8 bytes.
The Node doesn't read the file back, because another writer might have changed it. If a formatter
changed the text, the pane replaces what you see only if your local edit revision still matches, so
later edits stay dirty. When an older Node leaves out the saved body, the client keeps the text dirty
and asks for a Node update before closing.

Closing a file waits for its save, and keeps the tab if the save fails or you edit during the wait.
Retiring a pane model sends the final write through its captured Node.

### Recovery

Dirty text and CodeMirror undo state stay in device memory after the pane and model retire, with the
cursor and scroll. Device recovery storage keeps the full dirty and saved text, cursor, and scroll,
with no eviction limit. Storage can fail or run out of quota. The full document stays in memory, but a
restart can't bring back undo history or a record storage refused. Reopening the same file restores
recovery without reading from an offline Node. Recovery never replays a write on its own.

A host document flush rejects when saving fails. A surface action runs only after its revision is
acknowledged and still current. Autosave and retirement absorb that rejection and keep the recovery
record. A retired document handle can't read, write, or flush through a replacement. A new surface
gets a new handle and writer for the same document, because recovery stores content, not a frame's
grant. The host keeps its 2 MiB UTF-8 wire limit, and keeps oversized dirty text for recovery when it
refuses a write. The file pane has no such limit.

## Host document export and guarded replacement

The host document region offers **Export full text** through the host's file-saving dialog. The
export holds the whole live draft, including text past the editable limit. A stored oversized document
offers the same export without creating an editor or a handle. Its read route stays authorized by the
original Node and scope. Export gives the dialog bytes and a suggested name, and adds no plugin file
system or network access.

`bridge.document.write(text, { expectedText })` replaces the text only if the current text matches
([composed panes](./composed-panes.md#the-document-api)).

The terminal client uses the same custody address and save owner as the desktop. It keeps failed text
after the view retires and restores it under a fresh grant. It has no CodeMirror undo. An oversized
stored document shows recovery steps, and
[database scratch recovery](../database.md#scratch-limits-and-recovery) describes the full
authenticated export and replacement route.
