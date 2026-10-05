import { pickFiles } from '@acorn/plugin-api/client'
import type { AgentAttachment } from '../../contract/wire.ts'
import { managedAgentApi } from '../sessions/managedClient.ts'
import { decideReplacement } from './replaceAttachment.ts'
import type { ComposerOrigin } from './composerOrigin.ts'
import { operationError } from './composerOrigin.ts'

// The platform picker accepts bare extensions. Paste and drop already provide File objects.
const ATTACHMENT_EXTENSIONS = [
  'txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'ts', 'tsx', 'js', 'jsx', 'css', 'html',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'swift', 'sh', 'sql', 'diff', 'patch',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf',
]

export async function pickDraftAttachments(owner: ComposerOrigin): Promise<void> {
  const { state } = owner
  if (state.uploading()) return
  state.setUploading(true)
  try {
    const picked = await pickFiles({ accept: ATTACHMENT_EXTENSIONS })
    await addDraftFiles(owner, picked.map((file) => new File([file.bytes as BlobPart], file.name, { type: file.type })), true)
  } catch (caught) {
    state.setError(operationError(caught, 'Unable to upload attachment.'))
  } finally { state.setUploading(false) }
}

export async function addDraftFiles(owner: ComposerOrigin, files: File[], picking = false): Promise<void> {
  const { state, session } = owner
  if (!state.valid() || !files.length || (!picking && state.uploading())) return
  state.setUploading(true)
  state.setError('')
  try {
    await state.hydration
    if (!state.hydrated() || !state.valid()) return
    if (state.attachments().length + files.length > 8) {
      state.setError('A turn can include at most eight attachments.')
      return
    }
    const aggregate = state.attachments().reduce((total, item) => total + item.byteSize, 0)
      + files.reduce((total, file) => total + file.size, 0)
    if (aggregate > 25 * 1024 * 1024) {
      state.setError('Turn attachments are limited to 25 MiB in total.')
      return
    }
    // One rejected upload does not discard successful siblings.
    const uploaded = await Promise.allSettled(files.map((file) => managedAgentApi.uploadAttachment(session.taskId, file, owner)))
    state.setAttachments((current) => [...current, ...uploaded.flatMap(result =>
      result.status === 'fulfilled' && !current.some(item => item.id === result.value.id) ? [result.value] : [])])
    if (uploaded.some(result => result.status === 'rejected')) state.setError('Unable to upload attachment.')
  } catch (caught) {
    state.setError(operationError(caught, 'Unable to upload attachment.'))
  } finally { state.setUploading(false) }
}

export function removeDraftAttachment(owner: ComposerOrigin, attachment: AgentAttachment): void {
  owner.state.setAttachments((current) => current.filter((item) => item.id !== attachment.id))
  void managedAgentApi.removeAttachment(attachment.id, owner).catch(() => undefined)
}

/** Replace only the claimed slot. Persist the new id before deleting the old row. */
export async function replaceDraftAttachment(owner: ComposerOrigin, expected: AgentAttachment, payload: unknown): Promise<void> {
  const { expectedAttachmentId, replacementAttachmentId } = (payload ?? {}) as {
    expectedAttachmentId?: unknown
    replacementAttachmentId?: unknown
  }
  if (typeof replacementAttachmentId !== 'string' || !replacementAttachmentId)
    throw new Error('A replacement needs an attachment id.')
  const { state, session } = owner
  if (state.replacing()) throw new Error('Another replacement is already in progress.')
  if (!state.attachments().some((item) => item.id === expected.id))
    throw new Error('That attachment is no longer in this draft.')
  state.setReplacing(expected.id)
  try {
    const replacement = await managedAgentApi.attachment(replacementAttachmentId, owner)
    if (!state.valid()) return
    const decision = decideReplacement({
      current: state.attachments(), expectedId: expected.id, claimedExpectedId: expectedAttachmentId,
      replacement, taskId: session.taskId,
    })
    if (decision.kind === 'noop') return
    if (decision.kind === 'refuse') {
      void managedAgentApi.removeAttachment(replacement.id, owner).catch(() => undefined)
      throw new Error(decision.reason)
    }
    if (!state.setAttachments(decision.next)) return
    void managedAgentApi.removeAttachment(expected.id, owner).catch(() => undefined)
  } finally { state.setReplacing('') }
}
