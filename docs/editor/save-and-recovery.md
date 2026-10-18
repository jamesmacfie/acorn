# Saving and recovery

This page covers who writes a document, what a save acknowledgement carries, how unsaved text
survives, and exporting a host document. It's part of [editor](../editor.md). The custody code is in
`packages/client-core/src/features/editor/documentCustody.ts`.

## Save acknowledgements and recovery

Each file has one write owner, keyed by Node, task, and path. A host document region is keyed by
Node, scope kind, scope ID, URI, and its declared routes. A document admits one write at a time.
Repeated flushes join that write, and later edits wait in one follow-up slot. Separate documents save
separately. A clean document skips the request, its hooks, and its invalidation.

The Editor file read carries text and an opaque revision of the original UTF-8 bytes. Every file
save sends that revision. The Node runs before-save hooks, compares the revision immediately before
writing, and returns a typed conflict if the disk changed or disappeared. A null expected revision
creates a file only while it remains absent. The successful response carries the exact post-hook text
and revision. A formatter replaces the submitted edit only when nobody typed after admission.
Graphical clients refuse a Node that omits the read revision or save acknowledgement.

Editor file writes and file actions take the canonical checkout lock, including task-root aliases.
This serializes a folder action with admitted and queued descendant writes without nested locks.
File actions suspend affected custody owners before they join admitted saves. Overlapping
suspensions each keep their own hold until released. A confirmed trash choice can flush a draft
while ordinary writers stay suspended. A conflict or recovered draft that requires resolution
refuses that flush. External CLI
writers do not use these locks. The hash comparison and write have a remaining filesystem race
against those writers; they are not an atomic compare-and-swap.

Closing a file waits for its save, and keeps the tab if the save fails or you edit during the wait.
Retiring a pane model sends the final write through its captured Node.

### Recovery

Dirty text and CodeMirror undo state stay in device memory after the pane and model retire, with the
cursor and scroll. Device recovery storage keeps the full dirty and saved text, cursor, and scroll,
with no eviction limit. Storage can fail or run out of quota. The full document stays in memory, but a
restart can't bring back undo history or a record storage refused. Reopening the same file restores
recovery without reading from an offline Node. Recovery never replays a write on its own. A file
recovery record also keeps the acknowledged disk revision. A record written before that field existed
has an unknown baseline and requires a deliberate reload or overwrite after a disk read. A recovered
draft with a known baseline remains write-blocked even when disk still matches that revision; the
match informs comparison but does not authorize blur, close, or retirement to save it.

A host document flush rejects when saving fails. A surface action runs only after its revision is
acknowledged and still current. Autosave and retirement absorb that rejection and keep the recovery
record. A retired document handle can't read, write, or flush through a replacement. A new surface
gets a new handle and writer for the same document, because recovery stores content, not a frame's
grant. The host keeps its 2 MiB UTF-8 wire limit, and keeps oversized dirty text for recovery when it
refuses a write. The file pane has no such limit.

## Host document export and guarded replacement

A stored oversized document opens without an editor or a handle, and offers **Export full text**
through the host's file-saving dialog. An editable document has no export button. Its read route stays
authorized by the original Node and scope. Export gives the dialog bytes and a suggested name, and adds no plugin file
system or network access.

`bridge.document.write(text, { expectedText })` replaces the text only if the current text matches
([composed panes](./composed-panes.md#the-document-api)).

The terminal client uses the same custody address and save owner as the desktop. It keeps failed text
after the view retires and restores it under a fresh grant. It has no CodeMirror undo. An oversized
stored document shows recovery steps, and
[database scratch recovery](../database/pane.md#scratch-limits-and-recovery) describes the full
authenticated export and replacement route.
