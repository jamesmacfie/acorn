import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import { MAX_PLUGIN_BYTES } from '@acorn/protocol/plugin/bridge.ts'

// Another plugin's view of the media in a transcript: an attachment the person sent, or an artifact
// the agent produced (docs/managed-agents/attachments.md § Transcript media viewers).
//
// Two points and one read. The points let a plugin draw the body of a media card. The capability
// gives that plugin's Node half the bytes, after this plugin checks that the media belongs to the
// session and the session to the task. A media id alone grants nothing.
//
// Read-only on purpose. Stored media is the record of what a turn held or produced, and its bytes
// never change. The unsent composer draft has its own point and capability
// (`agents.draftAttachments`), and neither of these reaches it.

/** The body of a sent attachment's tile, keyed by its media type. `replace`. The tile's filename,
 *  size, and download stay this plugin's. */
export const AGENT_TRANSCRIPT_ATTACHMENT_POINT = 'agents:transcript-attachment'

/** The body of an artifact card, keyed by its media type. `replace`. The title, size, and download
 *  row stay this plugin's. */
export const AGENT_ARTIFACT_POINT = 'agents:artifact'

export type TranscriptMediaKind = 'attachment' | 'artifact'

export type TranscriptMedia = {
  kind: TranscriptMediaKind
  id: string
  /** The attachment's filename, or the artifact's title. */
  filename: string
  /** The point's key: lowercase, without parameters, `application/octet-stream` when unknown. */
  mediaType: string
  byteSize?: number
}

/** What both points hand a contributor. Pass `taskId`, `sessionId`, `media.kind`, and `media.id` back
 *  unchanged to `agents.transcriptMedia`. */
export type TranscriptMediaProps = {
  taskId: string
  sessionId: string
  media: TranscriptMedia
}

/** The matching key for a stored media type. `text/plain; charset=utf-8` matches `text/plain`. */
export const transcriptMediaType = (mediaType?: string | null): string =>
  mediaType?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream'

/** The binary bridge's cap, so any bytes this returns fit through `bridge.api.getBytes`. */
export const MAX_TRANSCRIPT_MEDIA_READ_BYTES = MAX_PLUGIN_BYTES

export type TranscriptMediaReadInput = {
  taskId: string
  sessionId: string
  kind: TranscriptMediaKind
  id: string
}

export type TranscriptMediaRead = {
  media: TranscriptMedia
  /** `null` when the content is over 12 MiB. The card's own download still reaches it. */
  bytes: Uint8Array | null
}

export type TranscriptMediaCapability = {
  /**
   * One attachment a turn of this session sent, or one artifact this session produced, with its
   * bytes.
   *
   * `null` for every refusal: another task or session, the wrong kind, a deleted row, missing content,
   * or an id that never existed. Telling them apart would answer questions about rows the caller may
   * not see. No path crosses, and nothing is written.
   */
  read(input: TranscriptMediaReadInput): Promise<TranscriptMediaRead | null>
}

export const AGENTS_TRANSCRIPT_MEDIA = capabilityId<TranscriptMediaCapability>('agents.transcriptMedia')
