import { QueryClient } from '@tanstack/solid-query'
import { tasksRoute } from '@acorn/protocol/api.ts'
import {
  createTask,
  integrationsOptions,
  projectsOptions,
  readJson,
  scanContentRefs,
  tasksKey,
  tasksOptions,
  workspaceExternalProjectsOptions,
  type SourceContribution,
  type Task,
} from '@acorn/plugin-api/client'
import type { Integration } from '@acorn/protocol/api.ts'
import { pullRoute, type Pull, type PullDetail } from '../shared/api'
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

// Which connected Linear a PR body's `ENG-42` belongs to, or null when that can't be settled.
//
// A task link has to name one connection, because an issue key is only unique inside a workspace. One
// connected Linear answers it outright. With several, the repo's own project map decides: someone has
// already said which Linear projects this repo follows, and that is a better answer than the first
// connection in the list. A link may name this project or the whole workspace, so both count.
//
// Two mapped Linears, or none, still yields null and the task is created without the link. That is
// the same outcome as before and the honest one: a link pointing at the wrong workspace resolves to
// an issue that isn't the one in the PR.
export async function linearConnectionForProject(
  queryClient: QueryClient,
  projectId: string,
  linears: readonly Integration[],
): Promise<string | null> {
  if (linears.length <= 1) return linears[0]?.id ?? null
  const projects = await queryClient.ensureQueryData(projectsOptions(true)).catch(() => [])
  const workspaceId = projects.find((project) => project.id === projectId)?.workspaceId
  if (!workspaceId) return null
  const mapped = await queryClient
    .ensureQueryData(workspaceExternalProjectsOptions(workspaceId, true))
    .catch(() => ({ projects: [] }))
  const connected = new Set(linears.map((connection) => connection.id))
  const candidates = new Set(
    mapped.projects
      .filter((row) => connected.has(row.integrationId) && (!row.projectId || row.projectId === projectId))
      .map((row) => row.integrationId),
  )
  return candidates.size === 1 ? [...candidates][0] : null
}

// The single PR → task workflow for both the repository PR list and related-PR tabs. Core owns the
// task write; GitHub owns how its pull identity, head branch, and linked references seed that write.
export async function promotePullToTask(queryClient: QueryClient, target: PullTaskTarget): Promise<Task> {
  const pullNumber = Number(target.number)
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) throw new Error('Pull request number is invalid.')
  if (!target.headRef.trim()) throw new Error('The pull request has no head branch to create a task from.')

  const tasks = await queryClient.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[])
  const existing = activeTaskForPull(tasks, target.projectId, pullNumber)
  if (existing) return existing

  const links = await linksForPull(queryClient, target)
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

// A task link needs an unambiguous connection. Both the direct PR action and the confirmation
// dialog derive links here, so they record the same references from the PR body.
async function linksForPull(queryClient: QueryClient, target: PullRef & { projectId: string }) {
  const detail = await queryClient
    .ensureQueryData(pullDetailOptions(target.owner, target.repo, target.number, true))
    .catch(() => undefined)
  const integrations = await queryClient.ensureQueryData(integrationsOptions(true)).catch(() => null)
  const linears = (integrations?.integrations ?? [])
    .filter((connection) => connection.providerId === 'linear' && connection.status === 'connected')
  const linearId = await linearConnectionForProject(queryClient, target.projectId, linears)
  return linearId
    ? scanContentRefs([detail?.pull?.body])
        .filter((ref) => ref.providerId === 'linear')
        .map((ref) => ({
          connectionId: linearId,
          identifier: ref.item,
          ref: { displayId: ref.item, url: ref.url },
        }))
    : []
}

/**
 * The source's promotion contract for the shared promote-to-task modal. Workflows opens it from
 * a pull request row (docs/workflows/starting-runs.md § Starting a run); Acorn links open it after
 * the content recogniser resolves a PR URL.
 *
 * There is no `attachToCurrentTask`: a pull request is recorded on the task
 * row as `pullNumber`, not as a link, so attaching one to somebody else's task is not a thing.
 */
export const githubPullPromotion: NonNullable<SourceContribution<Pull>['promotion']> = {
  fromContentLink: async (target) => {
    if (target.kind !== 'pr' || typeof target.owner !== 'string' || typeof target.repo !== 'string' || typeof target.number !== 'string') return null
    const detail = await readJson<PullDetail>(pullRoute(target.owner, target.repo, target.number))
    return detail.pull
  },
  existingTask: async (target, projectId) => {
    const number = Number(target.number)
    if (target.kind !== 'pr' || !Number.isSafeInteger(number) || number <= 0) return undefined
    const tasks = await readJson<Task[]>(tasksRoute)
    return activeTaskForPull(tasks, projectId, number)
  },
  canPromote: (pull, context) => !!context.projectId && !!pull.headRef,
  prepare: async (pull, context) => ({
    origin: 'github-pr',
    projectId: context.projectId,
    title: pull.title,
    branch: pull.headRef ?? context.branch,
    pullNumber: pull.number,
    links: context.owner && context.repo
      ? await linksForPull(new QueryClient(), { owner: context.owner, repo: context.repo, number: String(pull.number), projectId: context.projectId })
      : [],
  }),
  create: async (seed) => {
    const tasks = await readJson<Task[]>(tasksRoute).catch(() => [] as Task[])
    const existing = tasks.find((task) => task.status === 'active'
      && task.projectId === seed.projectId
      && task.pullNumber === seed.pullNumber)
    return existing ?? createTask(seed)
  },
}
