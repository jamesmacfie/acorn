import { Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { tasksOptions } from '@acorn/plugin-api/client'
import { Button } from '@acorn/plugin-api/ui'
import { BITBUCKET_HOST } from '../shared/pullRequestRef'

// "Open pull request" under the Changes tab's branch bar, once a task's branch is on its remote and it
// has no pull request yet. It opens Bitbucket's own form with the branch chosen, which compares the
// branches and picks the destination; an agent opens one with `pr_create`.

/** The git plugin's point, spelled out because a plugin may not import another plugin. */
export const GIT_PUSH_ACTIONS_POINT = 'git:push-actions'

/** What the git plugin hands a contributor, restated for the same reason. */
type PushActionsProps = { taskId: string; projectId: string; branch: string | null; upstream: string | null }

export const newPullRequestUrl = (repository: string, branch?: string) =>
  `https://${BITBUCKET_HOST}/${repository}/pull-requests/new${branch ? `?source=${encodeURIComponent(branch)}` : ''}`

export function BitbucketPushActions(props: PushActionsProps) {
  const tasks = createQuery(() => tasksOptions(true))
  const task = () => tasks.data?.find((row) => row.id === props.taskId)
  const repository = () => {
    const found = task()?.repository
    return found?.provider === 'bitbucket' ? found.path : null
  }
  const offered = () => !!props.upstream && !!props.branch && !!repository() && !task()?.changeRequest
  return (
    <Show when={offered()}>
      <Button
        size="sm"
        tip="Open a pull request for this branch on Bitbucket"
        tipSub={repository()!}
        href={newPullRequestUrl(repository()!, props.branch!)}
      >
        Open pull request
      </Button>
    </Show>
  )
}
