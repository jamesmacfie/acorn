import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'

// agents.draftAttachments: read one unsent image attachment, and store an altered copy of it.
//
// The seam a plugin that edits an attachment reaches agents through (docs/managed-agents.md § Draft
// attachments). A loaded plugin cannot call `/v2/p/agents/*` from its sandbox and should not be able
// to: cross-plugin route confinement is a security boundary, not an inconvenience. So the dependency is
// declared instead, in `requires.plugins` and `permissions.node.capabilities`, where a person reading
// the manifest at install time can see it.
//
// Two methods, and what is missing from them is the design. There is no "replace the draft" and no
// "delete the source". The unsent draft is an array in the composer's client state; the node does not
// own it, cannot transact with it, and deleting a source before the client has committed its swap
// would lose the reader's only valid attachment. This capability produces a candidate; the composer
// decides whether to keep it (plugins/agents/src/client/composer/AgentComposer.tsx).

export type DraftAttachmentBytes = {
  attachment: AgentAttachment
  bytes: Uint8Array
}

export type CreateDraftAttachmentReplacement = {
  taskId: string
  /** The attachment the caller edited. Rechecked immediately before the write, so a source that was
   *  sent or removed while an editor was open cannot be replaced after the fact. */
  sourceAttachmentId: string
  filename: string
  mediaType: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}

export type DraftAttachmentsCapability = {
  /**
   * One PNG or JPEG attachment of this task that no turn has claimed, with its content.
   *
   * `null` for every refusal, whether the attachment belongs to another task, was deleted, was already
   * sent, or never existed. Distinguishing them would answer questions about rows the caller may not
   * see. No filesystem path crosses: the caller gets bytes.
   */
  read(input: { taskId: string; attachmentId: string }): Promise<DraftAttachmentBytes | null>
  /**
   * Store an altered copy as a new attachment and return it.
   *
   * Always a new row, never an edit in place. Content-addressed storage, deduplication, draft recovery
   * and the record of what a sent turn contained all rest on stored bytes never changing. Content that
   * hashes to something already stored for this task deduplicates, so re-applying an edit that changed
   * nothing returns the source itself, which the caller treats as "no change".
   *
   * Everything ordinary upload checks, this checks: magic bytes decide the media type whatever the
   * caller claimed, the name is normalized, and the 10 MiB ceiling holds.
   */
  createReplacement(input: CreateDraftAttachmentReplacement): Promise<AgentAttachment>
}

export const AGENTS_DRAFT_ATTACHMENTS = capabilityId<DraftAttachmentsCapability>('agents.draftAttachments')
