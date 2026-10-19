import { activeNodeId, agentContextContributions } from '@acorn/plugin-api/client'
import type {
  AgentContextCaptureScope,
  AgentContextContribution,
  AgentContextSnapshot,
} from '@acorn/protocol/agentContext.ts'
import {
  AUTOMATIC_TASK_CONTEXT_SOURCE,
  TASK_CONTEXT_CONTRIBUTION_ID,
  automaticTaskContextFor,
  automaticTaskContextPayload,
} from './automaticTaskContext.ts'
import type { ComposerOrigin } from './composerOrigin.ts'
import { operationError } from './composerOrigin.ts'
import type { ContextReference } from './contextReferences.ts'

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
    if (
      state.capturing() ||
      session.kind !== 'interactive' ||
      before.some((context) => context.source === 'context.task')
    )
      return before
    const contribution = agentContextContributions().find((item) => item.id === TASK_CONTEXT_CONTRIBUTION_ID)
    if (!contribution) return before
    const revision = state.revisions()[2]
    const started = state.startCapture()
    const captured = (await contribution.capture({ taskId: session.taskId }))[0]
    if (
      !captured ||
      activeNodeId() !== owner.nodeId ||
      !state.captureCurrent(started) ||
      state.revisions()[2] !== revision
    )
      return before
    const automatic = automaticTaskContextFor(captured, previous)
    const next = before.filter((context) => context.source !== AUTOMATIC_TASK_CONTEXT_SOURCE)
    if (automatic && automaticTaskContextPayload(automatic) !== dismissedPayload) next.push(automatic)
    state.setContexts(next)
    return next
  })().finally(() => {
    if (state.automaticCapture?.run === run) state.automaticCapture = undefined
  })
  state.automaticCapture = { key, run }
  return run
}

// A loaded plugin's capture route has no deadline of its own, and a send that waits forever looks broken.
const CAPTURE_DEADLINE_MS = 10_000

const withDeadline = <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} took longer than ${CAPTURE_DEADLINE_MS / 1000} seconds.`)),
      CAPTURE_DEADLINE_MS,
    )
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/**
 * Snapshots for every `#` reference in a message, captured at send so the content is current. One
 * `capture` per source, and one snapshot per item however many times the message names it. Each
 * snapshot carries its token as `ref`, which is how the model links the block to the text.
 *
 * Throws, naming the token, when a source fails or leaves an item out: a message that says "compare
 * this with #agent:refactor-login" is wrong to send without it.
 */
export async function captureReferences(
  scope: AgentContextCaptureScope,
  references: readonly ContextReference[],
  contributions: readonly AgentContextContribution[] = agentContextContributions(),
): Promise<AgentContextSnapshot[]> {
  const byKeyword = new Map<string, ContextReference[]>()
  for (const reference of references) {
    const group = byKeyword.get(reference.keyword) ?? []
    if (!group.some((other) => other.itemId === reference.itemId)) group.push(reference)
    byKeyword.set(reference.keyword, group)
  }
  const captured = await Promise.all(
    [...byKeyword].map(async ([keyword, group]) => {
      const contribution = contributions.find((item) => item.keyword === keyword)
      const failure = (reason: string) => new Error(`Couldn't capture ${group[0]!.text}. ${reason}`)
      if (!contribution) throw failure('Its source is no longer available.')
      const ids = group.flatMap((reference) => (reference.itemId ? [reference.itemId] : []))
      let snapshots: AgentContextSnapshot[]
      try {
        snapshots = await withDeadline(
          contribution.capture(scope, contribution.itemless ? undefined : ids),
          contribution.label,
        )
      } catch (caught) {
        throw failure(operationError(caught, 'Its source refused.'))
      }
      if (contribution.itemless) {
        if (!snapshots.length) throw failure('Nothing came back.')
        return snapshots.map((snapshot) => ({ ...snapshot, ref: group[0]!.text }))
      }
      return group.map((reference) => {
        // Matched by `resourceId`. A source that leaves it off can still answer a single item.
        const snapshot =
          snapshots.find((candidate) => candidate.resourceId === reference.itemId) ??
          (group.length === 1 && snapshots.length === 1 ? snapshots[0] : undefined)
        if (!snapshot) throw new Error(`Couldn't capture ${reference.text}. Nothing came back for it.`)
        return { ...snapshot, ref: reference.text }
      })
    }),
  )
  return captured.flat()
}
