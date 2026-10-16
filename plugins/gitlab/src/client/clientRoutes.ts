import type { SourceRouteContribution, Task } from '@acorn/plugin-api/client'

// GitLab's browse surface addresses a merge request. Core owns /p/:projectId.
export const gitlabRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'gitlab.browse', path: '/p/:projectId/merge-requests', order: 30 },
  { id: 'gitlab.merge-request', path: '/p/:projectId/merge-requests/:number', order: 50 },
]

export const gitlabBrowsePath = (projectId: string) => `/p/${encodeURIComponent(projectId)}/merge-requests`

/** The task's primary merge request and its project path, when GitLab holds it. */
export function taskMergeRequest(
  task: Pick<Task, 'changeRequest' | 'repository'>,
): { path: string; number: number } | null {
  if (task.changeRequest?.provider !== 'gitlab' || task.repository?.provider !== 'gitlab') return null
  return { path: task.repository.path, number: task.changeRequest.number }
}

/** A project path's namespace and name, the two halves the shared views' scope carries. */
export const splitPath = (path: string) => {
  const at = path.lastIndexOf('/')
  return { owner: path.slice(0, at), repo: path.slice(at + 1) }
}
