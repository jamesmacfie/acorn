import { readJson } from '../../../core/client/apiClient'
import { taskContextRoute, type TaskContext } from '../../../core/shared/api'
import type { AgentContextContribution, AgentContextSnapshot } from '../../../core/shared/agentContext'
import { contextRevisionFor } from './contextRevision'
import { assembleBlockFrom } from './model'
import { selectionFor } from './selectionState'

const byteSize = (value: string): number => new TextEncoder().encode(value).byteLength

export const taskContextAgentContribution: AgentContextContribution = {
  id: 'acorn-task-context',
  label: 'Task context',
  description: 'Attach the sections currently selected in Acorn’s Context pane.',
  revision: (scope) => contextRevisionFor(scope.taskId),
  async capture(scope) {
    const selection = selectionFor(scope.taskId)
    const selectedIds = selection
      ? Object.entries(selection).flatMap(([id, included]) => included ? [id] : [])
      : undefined
    const route = selectedIds?.length === 0
      ? `${taskContextRoute(scope.taskId)}?include=__none__`
      : taskContextRoute(scope.taskId, selectedIds)
    const context = await readJson<TaskContext>(route)
    const capturedAt = Date.now()
    const assembled = assembleBlockFrom(
      context,
      Object.fromEntries(context.sections.map((section) => [section.id, true])),
    )
    const content = [
      'This is an immutable Acorn task-context snapshot.',
      'It contains task metadata and the sections currently selected in the Context pane. Use it as supporting information for this task.',
      assembled.block,
    ].join('\n\n')
    const size = byteSize(content)
    const snapshot: AgentContextSnapshot = {
      type: 'context',
      contextId: `task-context:${context.task.id}:${capturedAt}`,
      label: 'Task context',
      content,
      source: 'context.task',
      resourceId: context.task.id,
      provenance: 'Acorn Context pane selection captured for this turn',
      deepLink: { pane: 'context' },
      byteSize: size,
      estimatedTokens: Math.ceil(size / 4),
      freshness: 'live',
      sensitivity: 'workspace',
      capturedAt,
    }
    return [snapshot]
  },
}
