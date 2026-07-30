import { readJson } from '../../../core/client/apiClient'
import { taskContextRoute, type TaskContext } from '../../../core/shared/api'
import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { listRequests } from './httpClient'

const requestsForTask = async (taskId: string) => {
  const task = await readJson<TaskContext>(taskContextRoute(taskId))
  const slash = task.task.repo.indexOf('/')
  if (slash < 1) return []
  const owner = task.task.repo.slice(0, slash)
  const repo = task.task.repo.slice(slash + 1)
  return (await listRequests(owner, repo, taskId)).slice(0, 100)
}

export const httpAgentContextContribution: AgentContextContribution = {
  id: 'acorn-http',
  source: 'http',
  label: 'Saved HTTP requests',
  description: 'Capture request shapes with authorization, header values, variables and bodies redacted.',
  async options(scope) {
    return (await requestsForTask(scope.taskId)).map((request) => ({
      id: request.id,
      label: request.name,
      description: `${request.method} ${request.url}`,
    }))
  },
  async capture(scope, optionIds) {
    const requests = await requestsForTask(scope.taskId)
    const selected = optionIds ? requests.filter((request) => optionIds.includes(request.id)) : requests
    return selected.map((request) => {
      const content = [
        `# Saved HTTP request: ${request.name}`,
        `- ${request.method} ${request.url}`,
        `  folder: ${request.folder || '/'}; auth: ${request.auth.mode}; body: ${request.bodyMode}`,
        `  header names: ${request.headers.filter((header) => header.enabled).map((header) => header.name).join(', ') || 'none'}`,
        '',
        'All authorization values, header values, variables and request bodies are redacted.',
      ].join('\n')
      return contextSnapshot({
        contextId: `http:${request.id}:${Date.now()}`,
        label: `HTTP · ${request.name}`,
        content,
        source: 'http',
        resourceId: request.id,
        provenance: 'Saved request metadata with credential-bearing fields redacted',
        deepLink: { pane: 'http' },
        freshness: 'live',
        sensitivity: 'private',
      })
    })
  },
}
