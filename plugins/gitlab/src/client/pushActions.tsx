import { Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { tasksOptions } from '@acorn/plugin-api/client'
import { Button } from '@acorn/plugin-api/ui'
import { projectAddress } from '../shared/mergeRequestRef'

// "Open merge request" under the Changes tab's branch bar, once a task's branch is on its remote and
// it has no merge request yet. It opens GitLab's own form with the branch chosen, which compares
// the branches and picks the target; an agent opens one with `pr_create`.

/** The git plugin's point, spelled out because a plugin may not import another plugin. */
export const GIT_PUSH_ACTIONS_POINT = 'git:push-actions'

/** What the git plugin hands a contributor, restated for the same reason. */
type PushActionsProps = { taskId: string; projectId: string; branch: string | null; upstream: string | null }

export const newMergeRequestUrl = (address: string, branch?: string) =>
  `https://${address}/-/merge_requests/new${branch ? `?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}` : ''}`

export function GitlabPushActions(props: PushActionsProps) {
  const tasks = createQuery(() => tasksOptions(true))
  const task = () => tasks.data?.find((row) => row.id === props.taskId)
  const address = () => {
    const repository = task()?.repository
    return repository?.provider === 'gitlab' ? projectAddress(repository.host, repository.path) : null
  }
  const offered = () => !!props.upstream && !!props.branch && !!address() && !task()?.changeRequest
  return (
    <Show when={offered()}>
      <Button
        size="sm"
        tip="Open a merge request for this branch on GitLab"
        tipSub={address()!}
        href={newMergeRequestUrl(address()!, props.branch!)}
      >
        Open merge request
      </Button>
    </Show>
  )
}
