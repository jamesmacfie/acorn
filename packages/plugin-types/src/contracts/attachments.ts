export type DraftAttachment = {
  id: string
  taskId: string
  filename: string
  /** What the bytes are, decided by the agents store from magic bytes rather than from what anyone
   *  claimed on the way in. */
  mediaType: string
  byteSize: number
  createdAt: number
}

/** Read one unsent image attachment of a task, and store an altered copy of it
 *  (docs/managed-agents.md § Draft attachments).
 *
 * Two methods, and what is absent is the design. Neither replaces the draft nor deletes the source: the
 * unsent draft is an array in the agent composer's client state, the node cannot transact with it, and
 * deleting a source before the client has committed would lose the reader's only valid attachment. You
 * produce a candidate; the composer commits it when your tree asks, through the `agents:attachment`
 * point's declared `replace` action. */
export type DraftAttachmentsCapability = {
  /** One PNG or JPEG of this task that no turn has claimed, with its content.
   *
   * `null` covers every refusal — another task's, deleted, already sent, never existed — because
   * saying which would answer questions about rows you may not see. */
  read(input: { taskId: string; attachmentId: string }): Promise<{
    attachment: DraftAttachment
    bytes: Uint8Array
  } | null>
  /** Store an altered copy as a new attachment.
   *
   * Always a new row; stored bytes are never edited in place. The source is rechecked immediately
   * before the write, so an attachment sent while your editor was open cannot be replaced after the
   * fact. Magic bytes decide the media type whatever you claimed, the filename is normalized, and the
   * store's own size ceiling holds.
   *
   * Storage is content addressed, so bytes identical to something this task already holds come back as
   * that attachment. Re-applying an edit that changed nothing therefore returns the source itself, and
   * a caller treats that as "no change" rather than as a replacement. */
  createReplacement(input: {
    taskId: string
    sourceAttachmentId: string
    filename: string
    mediaType: 'image/png' | 'image/jpeg'
    bytes: Uint8Array
  }): Promise<DraftAttachment>
}
