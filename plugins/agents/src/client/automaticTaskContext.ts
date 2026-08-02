import type { AgentTurn } from '@acorn/protocol/managedAgents.ts'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'

export const TASK_CONTEXT_CONTRIBUTION_ID = 'acorn-task-context'
export const AUTOMATIC_TASK_CONTEXT_SOURCE = 'context.task.automatic'

const SNAPSHOT_SEPARATOR = '\n\n--- Acorn task context snapshot ---\n\n'

const byteSize = (value: string): number => new TextEncoder().encode(value).byteLength

export function automaticTaskContextPayload(context: AgentContextSnapshot): string {
  const separator = context.content.indexOf(SNAPSHOT_SEPARATOR)
  return separator < 0 ? context.content : context.content.slice(separator + SNAPSHOT_SEPARATOR.length)
}

export function latestAutomaticTaskContext(turns: AgentTurn[]): AgentContextSnapshot | undefined {
  for (const turn of [...turns].sort((left, right) => right.ordinal - left.ordinal)) {
    const context = [...turn.input].reverse().find((part): part is AgentContextSnapshot =>
      part.type === 'context' && part.source === AUTOMATIC_TASK_CONTEXT_SOURCE)
    if (context) return context
  }
  return undefined
}

export function automaticTaskContextFor(
  captured: AgentContextSnapshot,
  previous: AgentContextSnapshot | undefined,
): AgentContextSnapshot | null {
  if (previous && automaticTaskContextPayload(previous) === captured.content) return null
  const updated = previous != null
  const introduction = updated
    ? 'Acorn refreshed this task-context attachment because the Context pane changed since context was last sent. It may contain new or modified information that provides further context for this turn.'
    : 'Acorn attached this task-context snapshot because this managed chat was started from the task. It reflects the sections currently selected in the Context pane.'
  const content = `${introduction}${SNAPSHOT_SEPARATOR}${captured.content}`
  const size = byteSize(content)
  return {
    ...captured,
    contextId: `automatic:${captured.contextId}`,
    label: updated ? 'Task context · updated' : 'Task context · attached',
    content,
    source: AUTOMATIC_TASK_CONTEXT_SOURCE,
    provenance: updated
      ? 'Automatically refreshed after the Acorn Context pane changed'
      : 'Automatically attached when this task’s managed chat started',
    byteSize: size,
    estimatedTokens: Math.ceil(size / 4),
  }
}
