import { readJson } from '../../../core/client/apiClient'
import { taskContextRoute, type TaskContext } from '../../../core/shared/api'
import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { listRequests } from './httpClient'

export const httpAgentContextContribution: AgentContextContribution = {
  id: 'acorn-http',
  label: 'Saved HTTP requests',
  description: 'Capture request shapes with authorization, header values, variables and bodies redacted.',
  async capture(scope) {
    const task = await readJson<TaskContext>(taskContextRoute(scope.taskId))
    const slash = task.task.repo.indexOf('/')
    if (slash < 1) return []
    const owner = task.task.repo.slice(0, slash)
    const repo = task.task.repo.slice(slash + 1)
    const requests = (await listRequests(owner, repo, scope.taskId)).slice(0, 100)
    const content = [
      '# Saved HTTP requests',
      ...requests.map((request) => [
        `- ${request.name} · ${request.method} ${request.url}`,
        `  folder: ${request.folder || '/'}; auth: ${request.auth.mode}; body: ${request.bodyMode}`,
        `  header names: ${request.headers.filter((header) => header.enabled).map((header) => header.name).join(', ') || 'none'}`,
      ]).flat(),
      '',
      'All authorization values, header values, variables and request bodies are redacted.',
    ].join('\n')
    return [contextSnapshot({
      contextId: `http:${scope.taskId}:${Date.now()}`,
      label: `HTTP · ${requests.length} saved request${requests.length === 1 ? '' : 's'}`,
      content,
      source: 'http',
      resourceId: `${owner}/${repo}`,
      provenance: 'Saved request metadata with credential-bearing fields redacted',
      deepLink: { pane: 'http' },
      freshness: 'live',
      sensitivity: 'private',
    })]
  },
}
