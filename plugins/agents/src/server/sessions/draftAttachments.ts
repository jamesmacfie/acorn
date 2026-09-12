import type {
  CreateDraftAttachmentReplacement,
  DraftAttachmentBytes,
  DraftAttachmentsCapability,
} from '../../contract/draftAttachments'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'
import { imageEditKind, type AgentAttachmentStore } from './attachmentStore'

// The `agents.draftAttachments` capability over the attachment store (../../contract/draftAttachments.ts).
//
// Thin on purpose. Every rule that decides what may be stored already lives in the store, where the
// upload route reaches it too, so a second copy here would be a second thing to keep in step. What this
// file adds is the narrower question the capability asks: not "may this be stored" but "may a plugin
// that only knows a task id and an attachment id touch this one".

export const createDraftAttachments = (store: AgentAttachmentStore): DraftAttachmentsCapability => ({
  read: (input): Promise<DraftAttachmentBytes | null> => store.readDraft(input.taskId, input.attachmentId),

  createReplacement: async (input: CreateDraftAttachmentReplacement): Promise<AgentAttachment> => {
    // Rechecked here rather than trusted from whenever the caller last read it. An editor stays open for
    // as long as a person is drawing, and the attachment can be sent or removed in the meantime; the
    // source having become evidence of a turn is exactly when a replacement must stop being possible.
    const source = await store.readDraft(input.taskId, input.sourceAttachmentId)
    if (!source) throw new Error('That attachment is not an unsent draft of this task.')
    // What the caller says the bytes are does not decide anything. A JPEG announced as a PNG is stored
    // as what it is, and a GIF announced as either is refused: flattening an animation to one frame is
    // data loss wearing the shape of a format conversion.
    const kind = imageEditKind(input.bytes)
    if (!kind) throw new Error('A replacement attachment must be a PNG or a JPEG.')
    if (kind !== input.mediaType) throw new Error(`Those bytes are ${kind}, not ${input.mediaType}.`)
    // The ordinary upload path from here: same size ceiling, same magic-byte validation, same safe-name
    // normalization, same storage key, same deduplication. Content identical to something this task
    // already holds comes back as that attachment, so an edit that changed nothing is a no-op rather
    // than a second copy.
    return store.upload(input.taskId, input.filename, kind, input.bytes)
  },
})
