/** One piece of media in a transcript, as the `agents:transcript-attachment` and `agents:artifact`
 *  points hand it to you in `props.media`. */
export type TranscriptMedia = {
  kind: 'attachment' | 'artifact'
  id: string
  /** The attachment's filename, or the artifact's title. */
  filename: string
  /** Lowercase, without parameters, `application/octet-stream` when unknown. The points' key. */
  mediaType: string
  byteSize?: number
}

/** Read one sent attachment or one artifact of a managed agent session
 *  (docs/managed-agents/attachments.md § Transcript media viewers).
 *
 * Written out rather than `HostOwned`, like `agents.draftAttachments`, so a plugin outside this
 * repository can use the result without a cast. Read-only: stored media never changes. */
export type TranscriptMediaCapability = {
  /** Pass back the `taskId` and `sessionId` from the point's props, with `media.kind` and `media.id`.
   *
   * `null` covers every refusal: another task or session, the wrong kind, deleted, missing content, or
   * never existed. `bytes` is `null` when the content is over 12 MiB, the binary bridge's cap. */
  read(input: { taskId: string; sessionId: string; kind: 'attachment' | 'artifact'; id: string }): Promise<{
    media: TranscriptMedia
    bytes: Uint8Array | null
  } | null>
}
