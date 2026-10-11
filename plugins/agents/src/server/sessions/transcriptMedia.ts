import {
  MAX_TRANSCRIPT_MEDIA_READ_BYTES,
  transcriptMediaType,
  type TranscriptMedia,
  type TranscriptMediaCapability,
  type TranscriptMediaRead,
} from '../../contract/transcriptMedia'
import type { AgentArtifactStore } from './artifactStore'
import type { AgentAttachmentStore } from './attachmentStore'

// The `agents.transcriptMedia` capability over the two media stores.
//
// The same ownership the transcript's own routes check, asked the other way round. The routes resolve
// a media id to its task. A viewer already names the task and session, so this checks that the
// session is the task's, then that the media is the session's: an artifact the session produced, or
// an attachment of the task that one of the session's turns sent. A retired session still reads,
// because its task still names it.

const tooLarge = (byteSize: number | undefined): boolean => (byteSize ?? 0) > MAX_TRANSCRIPT_MEDIA_READ_BYTES

const withBytes = (media: TranscriptMedia, bytes: Uint8Array): TranscriptMediaRead => ({
  media,
  bytes: tooLarge(bytes.byteLength) ? null : bytes,
})

export const createTranscriptMedia = (deps: {
  taskIdForSession(sessionId: string): Promise<string | null>
  attachments: Pick<AgentAttachmentStore, 'get' | 'sentIn' | 'read'>
  artifacts: Pick<AgentArtifactStore, 'get' | 'read'>
}): TranscriptMediaCapability => ({
  read: async ({ taskId, sessionId, kind, id }) => {
    if ((await deps.taskIdForSession(sessionId)) !== taskId) return null

    if (kind === 'attachment') {
      const attachment = await deps.attachments.get(id)
      if (attachment?.taskId !== taskId || !(await deps.attachments.sentIn(sessionId, id))) return null
      const media: TranscriptMedia = {
        kind,
        id,
        filename: attachment.filename,
        mediaType: transcriptMediaType(attachment.mediaType),
        byteSize: attachment.byteSize,
      }
      if (tooLarge(media.byteSize)) return { media, bytes: null }
      const content = await deps.attachments.read(id)
      return content ? withBytes(media, content.bytes) : null
    }

    if (kind === 'artifact') {
      const artifact = await deps.artifacts.get(id)
      if (artifact?.sessionId !== sessionId) return null
      const media: TranscriptMedia = {
        kind,
        id,
        filename: artifact.title,
        mediaType: transcriptMediaType(artifact.mediaType),
        ...(artifact.byteSize == null ? {} : { byteSize: artifact.byteSize }),
      }
      if (tooLarge(media.byteSize)) return { media, bytes: null }
      // An artifact row without content, or whose object is gone, reads as absent.
      const content = await deps.artifacts.read(id).catch(() => null)
      return content ? withBytes(media, content.bytes) : null
    }

    return null
  },
})
