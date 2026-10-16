import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { GITLAB_PROVIDER } from './gitlabApi'
import { mirroredProject } from './mirror/projects'
import type { MirrorKey } from './mirror/detail'

export type TaskCore = Pick<CoreServices, 'tasks' | 'projects'>

/**
 * Which mirrored merge request a task is about: `number` in the task's project, or the task's primary
 * merge request when it names none. Null covers every way there is nothing to read: no task, no
 * GitLab repository, no merge request, no owner, and a project the mirror hasn't seen. A caller must
 * not read null as "nothing wrong": the CI policy fails closed on it.
 */
export async function taskMergeRequest(
  db: PluginDatabase,
  core: TaskCore,
  userId: string | null,
  taskId: string,
  number?: number,
): Promise<MirrorKey | null> {
  const task = await core.tasks.load(taskId)
  if (!task || !userId) return null
  const repository = (await core.projects.byId(task.projectId))?.repository
  if (repository?.provider !== GITLAB_PROVIDER) return null
  const iid =
    number ??
    (await core.tasks.changeRequests(taskId)).find(
      (link) => link.role === 'primary' && link.provider === GITLAB_PROVIDER,
    )?.number
  if (iid == null) return null
  const project = await mirroredProject(db, userId, repository.path)
  return project ? { userId, projectId: project.id, path: project.path, iid } : null
}
