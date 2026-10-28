import type { QueryClient } from '@tanstack/solid-query'
import { integrationsRoute, tasksRoute, type IntegrationsResponse } from '@acorn/protocol/api.ts'
import {
  createTask,
  readJson,
  tasksKey,
  tasksOptions,
  type SourceContribution,
  type Task,
} from '@acorn/plugin-api/client'
import { pullRequestRoute, type PullRequestDetail } from '../shared/api'
import { formatPullRequestRef, parsePullRequestRef, pullRequestUrl } from '../shared/pullRequestRef'

// A pull request becomes a task: its source branch is the task's branch and it is the task's primary
// change request, so core fetches that branch, from the fork when the pull request comes from one, and
// opens the `bitbucket-pr` pane. The task links its page, so the browser extension finds the task from
// the pull request's address.

export const activeTaskForPullRequest = (tasks: readonly Task[], projectId: string, number: number) =>
  tasks.find(
    (task) =>
      task.status === 'active' &&
      task.projectId === projectId &&
      task.changeRequest?.provider === 'bitbucket' &&
      task.changeRequest.number === number,
  )

type Target = {
  projectId: string
  repository: string
  number: number
  headRef: string
  sourceRepository: string | null
  title?: string
  skipSetup?: boolean
}

const seedFor = (target: Target, connectionId: string | undefined) => {
  const identifier = formatPullRequestRef(target.repository, target.number)
  return {
    origin: 'bitbucket-pr',
    projectId: target.projectId,
    ...(target.title ? { title: target.title } : {}),
    branch: target.headRef,
    changeRequest: {
      number: target.number,
      sourceBranch: target.headRef,
      ...(target.sourceRepository ? { sourceRepository: target.sourceRepository } : {}),
    },
    links: connectionId
      ? [
          {
            connectionId,
            identifier,
            ref: { displayId: identifier, url: pullRequestUrl(target.repository, target.number) },
          },
        ]
      : [],
  }
}

/** The Bitbucket connection a task's link is stamped with. There is at most one. */
const connectionId = async (): Promise<string | undefined> => {
  const integrations = await readJson<IntegrationsResponse>(integrationsRoute).catch(() => null)
  return integrations?.integrations.find((entry) => entry.providerId === 'bitbucket' && entry.status === 'connected')
    ?.id
}

export async function promotePullRequestToTask(queryClient: QueryClient, target: Target): Promise<Task> {
  const tasks = await queryClient.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[])
  const existing = activeTaskForPullRequest(tasks, target.projectId, target.number)
  if (existing) return existing
  const task = await createTask({ ...seedFor(target, await connectionId()), skipSetup: target.skipSetup })
  await queryClient.invalidateQueries({ queryKey: tasksKey })
  return task
}

type Resolved = NonNullable<PullRequestDetail['request']> & { repository: string; sourceRepository: string | null }

/** How a pull request becomes a task from a content link or a dashboard row, through the shared
 *  promote-to-task modal. */
export const bitbucketPullRequestPromotion: NonNullable<SourceContribution<Resolved>['promotion']> = {
  fromContentLink: async (target) => {
    const ref = typeof target.item === 'string' ? parsePullRequestRef(target.item) : null
    if (!ref) return null
    const detail = await readJson<PullRequestDetail>(pullRequestRoute(ref.repository, ref.number))
    return detail.request
      ? { ...detail.request, repository: ref.repository, sourceRepository: detail.sourceRepository }
      : null
  },
  existingTask: async (target, projectId) => {
    const ref = typeof target.item === 'string' ? parsePullRequestRef(target.item) : null
    return ref ? activeTaskForPullRequest(await readJson<Task[]>(tasksRoute), projectId, Number(ref.number)) : undefined
  },
  canPromote: (request, context) => !!context.projectId && !!request.headRef,
  prepare: async (request, context) =>
    seedFor(
      {
        projectId: context.projectId,
        repository: request.repository,
        number: request.number,
        headRef: request.headRef ?? context.branch ?? '',
        sourceRepository: request.sourceRepository,
        title: request.title,
      },
      await connectionId(),
    ),
  create: async (seed) => {
    const tasks = await readJson<Task[]>(tasksRoute).catch(() => [] as Task[])
    const number = seed.changeRequest?.number
    return (number != null && activeTaskForPullRequest(tasks, seed.projectId, number)) || createTask(seed)
  },
}
