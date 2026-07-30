import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { fetchTaskContainers } from './dockerClient'

export const dockerAgentContextContribution: AgentContextContribution = {
  id: 'acorn-docker',
  label: 'Docker service state',
  description: 'Capture task-linked container state and ports without environment values or logs.',
  async capture(scope) {
    const containers = (await fetchTaskContainers(scope.taskId)).slice(0, 100)
    const content = [
      '# Docker services',
      ...containers.map((container) => [
        `- ${container.name} · ${container.image} · ${container.state} (${container.status})`,
        ...container.ports.map((port) =>
          `  - ${port.hostIp ?? 'localhost'}:${port.hostPort ?? '?'} → ${port.containerPort}/${port.protocol}`),
      ]).flat(),
    ].join('\n')
    return [contextSnapshot({
      contextId: `docker:${scope.taskId}:${Date.now()}`,
      label: `Docker · ${containers.length} container${containers.length === 1 ? '' : 's'}`,
      content,
      source: 'docker',
      resourceId: scope.taskId,
      provenance: 'Live task-linked container summary; env and logs excluded',
      deepLink: { pane: 'docker' },
      freshness: 'live',
      sensitivity: 'workspace',
    })]
  },
}
