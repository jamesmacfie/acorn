import { activeNodeId } from '@acorn/plugin-api/client'
import { agentContextContributions } from '@acorn/plugin-api/client'
import type { AgentContextContribution, AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import { AUTOMATIC_TASK_CONTEXT_SOURCE, TASK_CONTEXT_CONTRIBUTION_ID, automaticTaskContextFor, automaticTaskContextPayload } from './automaticTaskContext.ts'
import type { ComposerOrigin } from './composerOrigin.ts'
import { operationError } from './composerOrigin.ts'

export function contextBelongsTo(context: AgentContextSnapshot, contribution: AgentContextContribution): boolean {
  return context.source === contribution.source
    || (contribution.id === TASK_CONTEXT_CONTRIBUTION_ID && context.source === AUTOMATIC_TASK_CONTEXT_SOURCE)
}

export function refreshAutomaticContext(
  owner: ComposerOrigin,
  key: string,
  previous: AgentContextSnapshot | undefined,
  dismissedPayload: string | undefined,
): Promise<AgentContextSnapshot[]> {
  const { state, session } = owner
  if (state.automaticCapture?.key === key) return state.automaticCapture.run
  const run = (async () => {
    const before = state.contexts()
    if (state.capturing() || session.kind !== 'interactive'
      || before.some((context) => context.source === 'context.task')) return before
    const contribution = agentContextContributions().find((item) => item.id === TASK_CONTEXT_CONTRIBUTION_ID)
    if (!contribution) return before
    const revision = state.revisions()[2]
    const captureVersion = state.captureRevision()
    const captured = (await contribution.capture({ taskId: session.taskId }))[0]
    if (!captured || activeNodeId() !== owner.nodeId || !state.captureCurrent(captureVersion)
      || state.revisions()[2] !== revision) return before
    const automatic = automaticTaskContextFor(captured, previous)
    const next = before.filter((context) => context.source !== AUTOMATIC_TASK_CONTEXT_SOURCE)
    if (automatic && automaticTaskContextPayload(automatic) !== dismissedPayload) next.push(automatic)
    state.setContexts(next)
    return next
  })().finally(() => { if (state.automaticCapture?.run === run) state.automaticCapture = undefined })
  state.automaticCapture = { key, run }
  return run
}

export async function captureContext(
  owner: ComposerOrigin,
  contributionId: string,
  optionIds: readonly string[],
  closePicker: () => void,
): Promise<void> {
  const contribution = agentContextContributions().find((item) => item.id === contributionId)
  const { state, session } = owner
  if (!contribution || state.capturing()) return
  const revision = state.revisions()[2]
  const operation = state.captureRevision()
  state.setCapturing(contributionId)
  state.setError('')
  try {
    const captured = await contribution.capture({ taskId: session.taskId }, optionIds)
    if (!state.captureCurrent(operation) || activeNodeId() !== owner.nodeId || state.revisions()[2] !== revision) return
    state.setContexts((current) => [...current.filter((item) => !contextBelongsTo(item, contribution)), ...captured])
    if (owner.visible()) closePicker()
  } catch (caught) {
    state.setError(operationError(caught, 'Unable to capture Acorn context.'))
  } finally { state.setCapturing('') }
}
