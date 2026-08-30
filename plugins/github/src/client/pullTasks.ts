import type { QueryClient } from '@tanstack/solid-query'
import {
  createTask,
  integrationsOptions,
  scanContentRefs,
  tasksKey,
  tasksOptions,
  type Task,
} from '@acorn/plugin-api/client'
import type { PullRef } from '../shared/pullRef'
import { pullDetailOptions } from './queries'

export type PullTaskTarget = PullRef & {
  projectId: string
  headRef: string
}

export const activeTaskForPull = (
  tasks: readonly Task[],
  projectId: string,
  pullNumber: number,
): Task | undefined => tasks.find((task) =>
  task.status === 'active'
  && task.projectId === projectId
  && task.pullNumber === pullNumber)

// The single PR → task workflow for both the repository PR list and related-PR tabs. Core owns the
// task write; GitHub owns how its pull identity, head branch, and linked references seed that write.
export async function promotePullToTask(queryClient: QueryClient, target: PullTaskTarget): Promise<Task> {
  const pullNumber = Number(target.number)
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) throw new Error('Pull request number is invalid.')
  if (!target.headRef.trim()) throw new Error('The pull request has no head branch to create a task from.')

  const tasks = await queryClient.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[])
  const existing = activeTaskForPull(tasks, target.projectId, pullNumber)
  if (existing) return existing

  // Seed task links from the same warmed detail body regardless of which UI started the promotion.
  // A task link needs an unambiguous connection; several Linear accounts require a future picker.
  const detail = await queryClient
    .ensureQueryData(pullDetailOptions(target.owner, target.repo, target.number, true))
    .catch(() => undefined)
  const integrations = await queryClient.ensureQueryData(integrationsOptions(true)).catch(() => null)
  const linears = (integrations?.integrations ?? [])
    .filter((connection) => connection.providerId === 'linear' && connection.status === 'connected')
  const soleLinear = linears.length === 1 ? linears[0].id : null
  const links = soleLinear
    ? scanContentRefs([detail?.pull?.body])
        .filter((ref) => ref.providerId === 'linear')
        .map((ref) => ({
          connectionId: soleLinear,
          identifier: ref.item,
          ref: { displayId: ref.item, url: ref.url },
        }))
    : []

  const task = await createTask({
    origin: 'github-pr',
    projectId: target.projectId,
    branch: target.headRef,
    pullNumber,
    links,
  })
  await queryClient.invalidateQueries({ queryKey: tasksKey })
  return task
}
