import { readJson } from '@acorn/plugin-api/client'
import { taskContextRoute, type TaskContext } from '@acorn/protocol/api.ts'
import type { AgentContextContribution, AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import { contextRevisionFor } from './contextRevision'
import { assembleBlockFrom } from './model'
import { selectionFor } from './selectionStore'

const byteSize = (value: string): number => new TextEncoder().encode(value).byteLength

export const taskContextAgentContribution: AgentContextContribution = {
  id: 'acorn-task-context',
  source: 'context.task',
  keyword: 'task',
  label: 'Task context',
  description: 'Attach the sections currently selected in Acorn’s Context pane.',
  // `#task` alone. The sections are picked in the Context pane, not in the composer.
  itemless: true,
  revision: (scope) => contextRevisionFor(scope.taskId),
  // Itemless, so the composer never asks for options.
  options: async () => [],
  async capture(scope, optionIds) {
    const selection = selectionFor(scope.taskId)
    const selectedIds = optionIds
      ? [...optionIds]
      : selection
        ? Object.entries(selection).flatMap(([id, included]) => (included ? [id] : []))
        : undefined
    const route =
      selectedIds?.length === 0
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
