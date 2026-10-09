import { createSignal, type Component } from 'solid-js'
import { clientCapabilityId } from '@acorn/plugin-api/client'

export type WorkflowGitLaunchRequest = { nodeId: string | null; projectId: string; commitId: string; title: string; generation?: number }
const [request, setRequest] = createSignal<WorkflowGitLaunchRequest | null>(null)
let generation = 0
export const workflowGitLaunchRequest = request
export const openWorkflowGitLaunch = (next: WorkflowGitLaunchRequest) => { setRequest({ ...next, generation: ++generation }) }
export const closeWorkflowGitLaunch = (expected?: WorkflowGitLaunchRequest) => {
  if (!expected || request() === expected) setRequest(null)
}
export type WorkflowGitLaunch = {
  open: (request: WorkflowGitLaunchRequest) => void
  Dialog: Component<{ request: WorkflowGitLaunchRequest; onClose: () => void }>
}
export const WORKFLOW_GIT_LAUNCH = clientCapabilityId<WorkflowGitLaunch>('workflows.gitLaunch')
