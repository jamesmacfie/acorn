import type { CoreServices } from '@acorn/plugin-api/node'
import { BITBUCKET_PROVIDER } from './bitbucketApi'
import type { MirrorKey } from './mirror/detail'
import type { BitbucketAccount } from './account'

export type TaskCore = Pick<CoreServices, 'tasks' | 'projects'>

/**
 * Which pull request a task is about: `number` in the task's repository, or the task's primary pull
 * request when it names none. Null covers every way there is nothing to read: no task, no Bitbucket
 * repository, no connection, and no pull request. A caller must not read null as "nothing wrong": the
 * CI policy fails closed on it.
 */
export async function taskPullRequest(
  core: TaskCore,
  account: Pick<BitbucketAccount, 'connectionId'>,
  taskId: string,
  number?: number,
): Promise<MirrorKey | null> {
  const task = await core.tasks.load(taskId)
  if (!task) return null
  const repository = (await core.projects.byId(task.projectId))?.repository
  const connectionId = account.connectionId()
  if (repository?.provider !== BITBUCKET_PROVIDER || !connectionId) return null
  const found =
    number ??
    (await core.tasks.changeRequests(taskId)).find(
      (link) => link.role === 'primary' && link.provider === BITBUCKET_PROVIDER,
    )?.number
  return found == null ? null : { connectionId, repository: repository.path.toLowerCase(), number: found }
}
