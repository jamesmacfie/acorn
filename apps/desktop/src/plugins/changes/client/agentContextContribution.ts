import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { localGitApi } from './localGitClient'

export const changesAgentContextContribution: AgentContextContribution = {
  id: 'acorn-changes',
  label: 'Current worktree changes',
  description: 'Capture the staged and unstaged file inventory from Changes.',
  async capture(scope) {
    const changes = await localGitApi.changes(scope.taskId)
    const capturedAt = Date.now()
    const shown = changes.slice(0, 200)
    const content = [
      '# Current worktree changes',
      ...shown.map((change) => `- ${change.staged ? 'staged' : 'unstaged'} · ${change.status} · ${change.path}`),
      ...(changes.length > shown.length ? [`- … ${changes.length - shown.length} more omitted`] : []),
    ].join('\n')
    const bytes = new TextEncoder().encode(content).byteLength
    return [{
      type: 'context',
      contextId: `changes:${scope.taskId}:${capturedAt}`,
      label: `Changes · ${changes.length} file${changes.length === 1 ? '' : 's'}`,
      content,
      source: 'changes',
      resourceId: scope.taskId,
      provenance: 'Live git status captured from the task worktree',
      deepLink: { pane: 'changes' },
      byteSize: bytes,
      estimatedTokens: Math.ceil(bytes / 4),
      freshness: 'live',
      sensitivity: 'workspace',
      capturedAt,
    }]
  },
}
