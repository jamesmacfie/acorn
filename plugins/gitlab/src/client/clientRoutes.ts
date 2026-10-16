import type { SourceRouteContribution, Task } from '@acorn/plugin-api/client'
import { projectAddress } from '../shared/mergeRequestRef'

// GitLab's browse surface addresses a merge request. Core owns /p/:projectId.
export const gitlabRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'gitlab.browse', path: '/p/:projectId/merge-requests', order: 30 },
  { id: 'gitlab.merge-request', path: '/p/:projectId/merge-requests/:number', order: 50 },
]

export const gitlabBrowsePath = (projectId: string) => `/p/${encodeURIComponent(projectId)}/merge-requests`

/** The task's primary merge request and its project's address, when GitLab holds it. */
export function taskMergeRequest(
  task: Pick<Task, 'changeRequest' | 'repository'>,
): { address: string; number: number } | null {
  if (task.changeRequest?.provider !== 'gitlab' || task.repository?.provider !== 'gitlab') return null
  return { address: projectAddress(task.repository.host, task.repository.path), number: task.changeRequest.number }
}

/** A project address's namespace and name, the two halves the shared views' scope carries. The
 *  namespace starts with the server's host, so joining the two gives the address back. */
export const splitPath = (address: string) => {
  const at = address.lastIndexOf('/')
  return { owner: address.slice(0, at), repo: address.slice(at + 1) }
}
