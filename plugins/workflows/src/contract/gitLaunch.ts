import { createSignal, type Component } from 'solid-js'
import { clientCapabilityId } from '@acorn/plugin-api/client'

export type WorkflowGitLaunchRequest = { nodeId: string | null; projectId: string; commitId: string; title: string; tracked?: true }
const [request, setRequest] = createSignal<WorkflowGitLaunchRequest | null>(null)
export const workflowGitLaunchRequest = request
// `tracked` marks a request opened here, so its dialog stays current only while it's still the open request.
export const openWorkflowGitLaunch = (next: WorkflowGitLaunchRequest) => { setRequest({ ...next, tracked: true }) }
export const closeWorkflowGitLaunch = (expected?: WorkflowGitLaunchRequest) => {
  if (!expected || request() === expected) setRequest(null)
}
export type WorkflowGitLaunch = {
  open: (request: WorkflowGitLaunchRequest) => void
  Dialog: Component<{ request: WorkflowGitLaunchRequest; onClose: () => void }>
}
export const WORKFLOW_GIT_LAUNCH = clientCapabilityId<WorkflowGitLaunch>('workflows.gitLaunch')
