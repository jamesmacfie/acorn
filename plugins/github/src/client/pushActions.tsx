import { Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { setSelectedSource, tasksOptions } from '@acorn/plugin-api/client'
import { Button } from '@acorn/plugin-api/ui'
import { githubCreateRoute } from './clientRoutes'

// What this plugin offers under the Changes pane's branch bar, once a task's branch is on its remote
// (docs/plugins.md § Cooperative extension points, the `remote` kind). One button, and it opens this
// plugin's own create form with the head branch already chosen.
//
// The changes plugin declared the point and knows none of this. It could not import this plugin, and
// should not have to learn what a pull request is to leave room for one; it hands over the branch,
// the upstream and the two ids, and every word here is written on this side.

/** The point this fills. Spelled out rather than imported: a plugin may not import another plugin, and
 *  that boundary is the reason the point exists. The string is the contract, the host mints it from
 *  the manifest it was read under, and a typo shows up on this plugin's page as a contribution whose
 *  point nobody declares. */
export const CHANGES_PUSH_ACTIONS_POINT = 'changes:push-actions'

/**
 * What the owner hands a contributor, in the owner's own words.
 *
 * Restated here for the same reason the point id is: this file cannot read the owner's module. A prop
 * whose name drifted arrives as `undefined`, which is why the button's gate treats a missing upstream
 * as "not yet" rather than throwing.
 */
type PushActionsProps = {
  taskId: string
  projectId: string
  branch: string | null
  upstream: string | null
  ahead: number | null
}

const createPath = (projectId: string, head: string): string =>
  `${githubCreateRoute.replace(':projectId', encodeURIComponent(projectId))}?head=${encodeURIComponent(head)}`

export function GithubPushActions(props: PushActionsProps) {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const task = () => tasks.data?.find((row) => row.id === props.taskId)
  // The repository this task's project mirrors, which is also the answer to "is this a GitHub project
  // at all". Core derives it from the project row, so a task on a mirrored project carries it whatever
  // the task's origin was (node-core routes/projects/tasks.ts).
  const repo = () => task()?.github
  /**
   * Four questions, and only two of them come from the props.
   *
   * A branch with no upstream has nothing to open a pull request from, and neither has a detached
   * HEAD. A project with no mirrored repository has nowhere to open one. And a task that already has
   * a pull request has the PR pane, which owns everything about it from then on — `pullNumber` off
   * this plugin's own task query, never out of the slot's props, because the owner does not know the
   * word (docs/plugins.md § Client authoring and the UI kit, `tracksRef`).
   */
  const offered = () => !!props.upstream && !!props.branch && !!repo() && task()?.pullNumber == null
  return (
    <Show when={offered()}>
      <Button
        size="sm"
        tip="Open a pull request for this branch"
        tipSub={`${repo()!.owner}/${repo()!.name}`}
        onPress={() => {
          // The rail source first, then the route. The shell draws from the selected source rather
          // than from the location, so navigating alone would move the address bar and leave the
          // task's layout on screen (./commands.ts § github.pull.list).
          setSelectedSource('github')
          navigate(createPath(props.projectId, props.branch!))
        }}
      >
        Open pull request
      </Button>
    </Show>
  )
}
