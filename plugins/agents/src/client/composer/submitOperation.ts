import { agentContextBudget, type AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import type { AgentInputPart } from '../../contract/wire.ts'
import { managedAgentApi } from '../sessions/managedClient.ts'
import { parseFileMentions } from './fileMentions.ts'
import type { ComposerOrigin } from './composerOrigin.ts'
import { operationError } from './composerOrigin.ts'

type Submission = {
  origin: ComposerOrigin
  paths: readonly string[]
  policy: Record<string, unknown>
  refreshContext: () => Promise<AgentContextSnapshot[]>
  onSent: () => void
}

export async function submitTurn({ origin, paths, policy, refreshContext, onSent }: Submission): Promise<void> {
  const { state, session } = origin
  const text = state.text().trim()
  const revisions = [...state.revisions()]
  const submittedAttachments = state.attachments()
  state.setSending(true)
  state.setError('')
  try {
    const turnContexts = await refreshContext()
    if (!state.valid()) return
    // A capture made by this send is part of the submitted revision. Later edits remain in the draft.
    if (state.contexts() === turnContexts) revisions[2] = state.revisions()[2]
    if (agentContextBudget(turnContexts).overLimit) {
      state.setError('Remove some context before sending; Acorn snapshots are limited to 512 KiB per turn.')
      return
    }
    const input: AgentInputPart[] = [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...parseFileMentions(text, paths),
      ...submittedAttachments.map((attachment): AgentInputPart => attachment.mediaType.startsWith('image/')
        ? { type: 'image', attachmentId: attachment.id, alt: attachment.filename }
        : { type: 'attachment', attachmentId: attachment.id }),
      ...turnContexts,
    ]
    await managedAgentApi.enqueue(session.id, { input, source: 'interactive', effectivePolicy: policy }, undefined, origin)
    state.acknowledge(revisions, submittedAttachments, turnContexts)
    if (origin.visible()) onSent()
  } catch (caught) {
    state.setError(operationError(caught, 'Unable to queue this turn.'))
  } finally { state.setSending(false) }
}
