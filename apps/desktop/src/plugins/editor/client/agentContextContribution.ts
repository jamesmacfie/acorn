import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { activeFile, openFiles } from './editorState'

export const editorAgentContextContribution: AgentContextContribution = {
  id: 'acorn-editor',
  label: 'Editor files',
  description: 'Capture the active file and open-file inventory. File contents are added only by explicit @ mention.',
  async capture(scope) {
    const active = activeFile(scope.taskId)
    const files = openFiles(scope.taskId)
    const content = [
      '# Editor state',
      active ? `Active file: ${active}` : 'Active file: none',
      ...files.slice(0, 100).map((file) =>
        `- ${file.path}${file.dirty ? ' (unsaved)' : ''}${file.ephemeral ? ' (preview)' : ''}`),
    ].join('\n')
    return [contextSnapshot({
      contextId: `editor:${scope.taskId}:${Date.now()}`,
      label: active ? `Editor · ${active}` : 'Editor · no active file',
      content,
      source: 'editor',
      resourceId: active ?? scope.taskId,
      provenance: 'Live editor tab state; contents intentionally excluded',
      deepLink: { pane: 'editor', intent: active ? { kind: 'editor:reveal', path: active, line: 1 } : undefined },
      freshness: 'live',
      sensitivity: 'workspace',
    })]
  },
}
