import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { fetchTaskContainers } from './dockerClient'

export const dockerAgentContextContribution: AgentContextContribution = {
  id: 'acorn-docker',
  source: 'docker',
  label: 'Docker service state',
  description: 'Capture task-linked container state and ports without environment values or logs.',
  async options(scope) {
    return (await fetchTaskContainers(scope.taskId)).slice(0, 100).map((container) => ({
      id: container.id,
      label: container.name,
      description: `${container.image} · ${container.state} · ${container.status}`,
    }))
  },
  async capture(scope, optionIds) {
    const containers = (await fetchTaskContainers(scope.taskId)).slice(0, 100)
    const selected = optionIds ? containers.filter((container) => optionIds.includes(container.id)) : containers
    return selected.map((container) => {
      const content = [
        `# Docker service: ${container.name}`,
        `- ${container.image} · ${container.state} (${container.status})`,
        ...container.ports.map((port) =>
          `  - ${port.hostIp ?? 'localhost'}:${port.hostPort ?? '?'} → ${port.containerPort}/${port.protocol}`),
      ].join('\n')
      return contextSnapshot({
        contextId: `docker:${container.id}:${Date.now()}`,
        label: `Docker · ${container.name}`,
        content,
        source: 'docker',
        resourceId: container.id,
        provenance: 'Live task-linked container summary; env and logs excluded',
        deepLink: { pane: 'docker' },
        freshness: 'live',
        sensitivity: 'workspace',
      })
    })
  },
}
