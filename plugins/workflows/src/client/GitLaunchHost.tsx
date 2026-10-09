import { Show } from 'solid-js'
import { closeWorkflowGitLaunch, workflowGitLaunchRequest } from '../contract/gitLaunch.ts'
import GitLaunchDialog from './GitLaunchDialog'

export default function GitLaunchHost() {
  return <Show when={workflowGitLaunchRequest()} keyed>{(request) =>
    <GitLaunchDialog request={request} onClose={closeWorkflowGitLaunch} />
  }</Show>
}
