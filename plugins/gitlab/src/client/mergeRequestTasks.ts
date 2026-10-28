import type { QueryClient } from '@tanstack/solid-query'
import { tasksRoute } from '@acorn/protocol/api.ts'
import {
  createTask,
  readJson,
  tasksKey,
  tasksOptions,
  type SourceContribution,
  type Task,
} from '@acorn/plugin-api/client'
import { mergeRequestRoute, serversRoute, type GitlabServerSummary, type MergeRequestDetail } from '../shared/api'
import { formatMergeRequestRef, mergeRequestUrl, parseMergeRequestRef, splitAddress } from '../shared/mergeRequestRef'

// A merge request becomes a task: its source branch is the task's branch, it is the task's primary
// change request, so core checks out `merge-requests/<n>/head` and opens the `mr` pane, and the task
// links its page, so the browser extension finds the task from the merge request's address.

export const activeTaskForMergeRequest = (tasks: readonly Task[], projectId: string, number: number) =>
  tasks.find(
    (task) =>
      task.status === 'active' &&
      task.projectId === projectId &&
      task.changeRequest?.provider === 'gitlab' &&
      task.changeRequest.number === number,
  )

type Target = {
  projectId: string
  address: string
  number: number
  headRef: string
  title?: string
  skipSetup?: boolean
}

// The task's link to its merge request, under the connection on its server. None without one.
const selfLink = (connectionId: string | undefined, address: string, number: number) => {
  if (!connectionId) return []
  const identifier = formatMergeRequestRef(address, number)
  return [{ connectionId, identifier, ref: { displayId: identifier, url: mergeRequestUrl(address, number) } }]
}

const seedFor = (target: Target, connectionId: string | undefined) => ({
  origin: 'gitlab-mr',
  projectId: target.projectId,
  ...(target.title ? { title: target.title } : {}),
  branch: target.headRef,
  changeRequest: { number: target.number, sourceBranch: target.headRef },
  links: selfLink(connectionId, target.address, target.number),
})

/** The connection on the server an address is on. */
const connectionFor = async (address: string): Promise<string | undefined> => {
  const servers = await readJson<GitlabServerSummary[]>(serversRoute).catch(() => [])
  return servers.find((server) => server.host === splitAddress(address).host)?.connectionId
}

export async function promoteMergeRequestToTask(queryClient: QueryClient, target: Target): Promise<Task> {
  const tasks = await queryClient.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[])
  const existing = activeTaskForMergeRequest(tasks, target.projectId, target.number)
  if (existing) return existing
  const task = await createTask({
    ...seedFor(target, await connectionFor(target.address)),
    skipSetup: target.skipSetup,
  })
  await queryClient.invalidateQueries({ queryKey: tasksKey })
  return task
}

type Resolved = NonNullable<MergeRequestDetail['request']> & { address: string }

/** How a merge request becomes a task from a content link or a dashboard row, through the shared
 *  promote-to-task modal. */
export const gitlabMergeRequestPromotion: NonNullable<SourceContribution<Resolved>['promotion']> = {
  fromContentLink: async (target) => {
    const ref = typeof target.item === 'string' ? parseMergeRequestRef(target.item) : null
    if (!ref) return null
    const detail = await readJson<MergeRequestDetail>(mergeRequestRoute(ref.address, ref.number))
    return detail.request ? { ...detail.request, address: ref.address } : null
  },
  existingTask: async (target, projectId) => {
    const ref = typeof target.item === 'string' ? parseMergeRequestRef(target.item) : null
    return ref
      ? activeTaskForMergeRequest(await readJson<Task[]>(tasksRoute), projectId, Number(ref.number))
      : undefined
  },
  canPromote: (request, context) => !!context.projectId && !!request.headRef,
  prepare: async (request, context) =>
    seedFor(
      {
        projectId: context.projectId,
        address: request.address,
        number: request.number,
        headRef: request.headRef ?? context.branch ?? '',
        title: request.title,
      },
      await connectionFor(request.address),
    ),
  create: async (seed) => {
    const tasks = await readJson<Task[]>(tasksRoute).catch(() => [] as Task[])
    const number = seed.changeRequest?.number
    return (number != null && activeTaskForMergeRequest(tasks, seed.projectId, number)) || createTask(seed)
  },
}
