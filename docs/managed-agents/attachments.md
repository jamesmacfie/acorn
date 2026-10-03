# Context, files, and attachments

This page covers how a turn carries task context, attachments, and artifacts, and how another plugin
can draw or replace an attachment before the turn is sent.

## Context and artifacts

The Node assembles context from registered task sections and sends it as an immutable snapshot
([context sections](../agent-tools/context-sections.md)). Attachments are validated, scoped to a task,
stored through the shared blob cache, and referenced by session records. Artifacts are authenticated
downloads with `no-store`. Provider and worktree paths are checked again against the owning task.
Raster image artifacts draw inline in the transcript with a download action. Other media types keep
the download row.

A sent attachment comes from `GET /v1/p/agents/attachments/:id/content`, with `no-store` and
`nosniff`, guarded by the attachment's task. Each one is a tile sized to its contents. A picture draws
as a cropped band above its filename and opens full size on press. Anything else draws an icon and
downloads on press. The turn's text names each attachment as `[Attachment: <id>]`, which is what the
harness receives, and the transcript drops that line when it has a tile to draw. This read is wider
than the draft read below, because a sent attachment is out of a plugin's reach and its sender wants
to see it again.

## Draft attachments

An attachment on an unsent turn is a draft: a row and a content-addressed blob that no turn
references. The composer owns which drafts are in the turn, as an array in client state with the IDs
in local storage. The Node owns the content. Sending makes a draft part of the record, and stored
bytes are never edited in place. Content addressing, deduplication, draft recovery, and the record of
what a turn held all rest on that.

Another plugin can draw an attachment instead of the composer's chip, and can hand back an edited
one, through two seams.

`agents.draftAttachments` is a Node capability with two methods
(`plugins/agents/src/contract/draftAttachments.ts`):

- `read` returns the bytes of one PNG or JPEG draft of a named task, never a path. It answers `null`
  for every refusal, so it says nothing about rows the caller can't see.
- `createReplacement` stores an edited copy through the ordinary upload path: the same 10 MiB limit,
  magic-byte check, name rules, and deduplication. Identical bytes come back as the source. It checks
  the source again right before writing, because the turn can be sent while the editor is open.

A loaded plugin declares `requires.plugins: [{ id: "agents" }]` and the capability in
`permissions.node.capabilities`, and resolves it at call time.

Neither method changes the draft or deletes the source. The Node doesn't own the client's array, and
deleting the source first would lose your only valid attachment. So `createReplacement` makes a
candidate, and the composer commits it through the `agents:attachment` point's `replace` action
([asking the owner](../plugins/remote-points.md#asking-the-owner)).

The commit is a compare-and-swap. The edited ID must still be in its slot, the replacement must
belong to the same task and be an image, and the draft's count and size limits must still hold. One
array element changes, order stays, and **Send** and that slot's remove are disabled while it runs.
The new ID is stored before the old one is cleaned up, so a crash leaves an extra row for the 24-hour
sweep, not a draft pointing at deleted content. A rejected candidate is deleted on a best-effort basis
and the original stays.

The turn stores `{ type: 'attachment', attachmentId }`, and both drivers resolve the ID to a local path
at dispatch, so swapping the ID before the turn is queued is all it takes.
