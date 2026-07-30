import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { currentPreviewUrl } from './PreviewPane'

const previewLabel = (url: string): string => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export const previewAgentContextContribution: AgentContextContribution = {
  id: 'acorn-preview',
  label: 'Preview page',
  description: 'Capture the current task preview URL. DOM evidence and screenshots remain explicit actions.',
  async capture(scope) {
    const url = currentPreviewUrl(scope.taskId)
    if (!url) return []
    return [contextSnapshot({
      contextId: `preview:${scope.taskId}:${Date.now()}`,
      label: `Preview · ${previewLabel(url)}`,
      content: `# Preview\nCurrent URL: ${url}\n\nNo DOM, console, network data or screenshot was captured.`,
      source: 'preview',
      resourceId: url,
      provenance: 'Live URL from the task-addressed Preview surface',
      deepLink: { pane: 'preview' },
      freshness: 'live',
      sensitivity: 'workspace',
    })]
  },
}
