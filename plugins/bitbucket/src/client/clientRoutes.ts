import type { SourceRouteContribution, Task } from '@acorn/plugin-api/client'

// Bitbucket's browse surface addresses a pull request. Core owns /p/:projectId.
export const bitbucketRouteContributions: readonly SourceRouteContribution[] = [
  { id: 'bitbucket.browse', path: '/p/:projectId/pull-requests', order: 30 },
  { id: 'bitbucket.pull-request', path: '/p/:projectId/pull-requests/:number', order: 50 },
]

export const bitbucketBrowsePath = (projectId: string) => `/p/${encodeURIComponent(projectId)}/pull-requests`

/** The task's primary pull request and its repository's full name, when Bitbucket holds it. */
export function taskPullRequest(
  task: Pick<Task, 'changeRequest' | 'repository'>,
): { repository: string; number: number } | null {
  if (task.changeRequest?.provider !== 'bitbucket' || task.repository?.provider !== 'bitbucket') return null
  return { repository: task.repository.path, number: task.changeRequest.number }
}

/** A full name's workspace and slug, the two halves the shared views' scope carries. */
export const splitRepository = (repository: string) => {
  const at = repository.indexOf('/')
  return { owner: repository.slice(0, at), repo: repository.slice(at + 1) }
}
