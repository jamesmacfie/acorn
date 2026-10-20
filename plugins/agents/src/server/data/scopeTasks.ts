import type { CoreServices } from '@acorn/plugin-api/node'

// The tasks an agents data source's scope reaches, which its SQL read narrows by.

type Scope = { workspaceId?: string; projectId?: string }

type ScopedTask = { title: string; status: string; projectId: string; projectName: string }

/** Every task of these projects, archived and cancelled ones included, by id. */
async function projectTasks(
  core: Pick<CoreServices, 'tasks'>,
  projects: readonly { id: string; name: string }[],
): Promise<Map<string, ScopedTask>> {
  const tasks = new Map<string, ScopedTask>()
  for (const project of projects)
    for (const task of await core.tasks.inProject(project.id))
      tasks.set(task.id, { title: task.title, status: task.status, projectId: project.id, projectName: project.name })
  return tasks
}

/**
 * The tasks a scope reaches, or null when it names neither a workspace nor a project. Only device and
 * service principals call these sources, so a whole-Node read is the person's own view of their Node.
 */
export async function scopeTasks(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  scope: Scope,
): Promise<Map<string, ScopedTask> | null> {
  if (!scope.workspaceId && !scope.projectId) return null
  const projects = scope.workspaceId
    ? (await core.projects.byWorkspace(scope.workspaceId)).filter(
        (project) => !scope.projectId || project.id === scope.projectId,
      )
    : [await core.projects.byId(scope.projectId!)].filter((project) => project !== null)
  return projectTasks(core, projects)
}

/** The scope's tasks, or for a whole-Node read, the tasks of the projects these rows name. */
export async function tasksOfRows(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  scoped: Map<string, ScopedTask> | null,
  projectIds: readonly (string | null)[],
): Promise<Map<string, ScopedTask>> {
  if (scoped) return scoped
  const projects = []
  for (const id of new Set(projectIds)) {
    const project = id ? await core.projects.byId(id) : null
    if (project) projects.push(project)
  }
  return projectTasks(core, projects)
}
