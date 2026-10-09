import { activeNodeId, clientCapability, toast } from '@acorn/plugin-api/client'
import { WORKFLOW_GIT_LAUNCH } from '@acorn/plugin-workflows/contract/gitLaunch.ts'

export function launchWorkflowAtCommit(projectId: string, commitId: string, title: string): void {
  const workflow = clientCapability(WORKFLOW_GIT_LAUNCH)
  if (!workflow) {
    toast('Workflows is unavailable on this Node.', { tone: 'danger' })
    return
  }
  workflow.open({ nodeId: activeNodeId(), projectId, commitId, title })
}
