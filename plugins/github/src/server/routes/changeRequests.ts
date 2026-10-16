import { Hono, type Context } from 'hono'
import { changeRequestCreateInput } from '@acorn/protocol/plugin/contract.ts'
import {
  type AppEnv,
  type CoreServices,
  mayActOnTask,
  ownerId,
  type PluginDatabase,
  respondError,
} from '@acorn/plugin-api/node'
import { createPullRequest } from '../createPull'
import { type GithubEmit, NO_EMIT } from '../events'
import { githubToken } from '../githubToken'
import {
  checkFailed,
  checkPending,
  mirroredPullRequest,
  mirroredTaskPull,
  taskChecks,
  taskReviewFeedback,
} from '../mirrorQueries'

// The routes under this plugin's `codeHost.changeRequest.api`, which core's `pr` context section and
// `pr_*` agent tools call (docs/plugins/code-hosts.md § Agent context). The reads answer from the
// mirror, so none spends a credential, and a 404 means nothing is mirrored for that pull request.
export const changeRequestRoutes = (
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  emit: GithubEmit = NO_EMIT,
) => {
  // The task's pull request `:number`, when the caller may act on the task and the mirror has it.
  const mirrored = async (c: Context<AppEnv>) => {
    const taskId = c.req.query('taskId')
    const number = Number(c.req.param('number'))
    if (!taskId || !mayActOnTask(c, taskId) || !Number.isSafeInteger(number)) return null
    return mirroredTaskPull(db, core, ownerId(c), taskId, number)
  }

  return (
    new Hono<AppEnv>()
      .get('/:number', async (c) => {
        const pull = await mirrored(c)
        const detail = pull && (await mirroredPullRequest(db, pull.userId, pull.owner, pull.repo, pull.number))
        return detail ? c.json(detail) : respondError(c, 404, 'not_found')
      })
      .get('/:number/checks', async (c) => {
        const pull = await mirrored(c)
        const checks = pull && (await taskChecks(db, pull))
        if (!checks) return respondError(c, 404, 'not_found')
        return c.json({
          ...checks,
          failing: checks.checks.filter((row) => checkFailed(row.status)).map((row) => row.name),
          pending: checks.checks.filter((row) => checkPending(row.status)).map((row) => row.name),
        })
      })
      .get('/:number/feedback', async (c) => {
        const pull = await mirrored(c)
        if (!pull) return respondError(c, 404, 'not_found')
        return c.json(
          await taskReviewFeedback(db, pull, { includeResolved: c.req.query('includeResolved') === 'true' }),
        )
      })
      // Opens a pull request from `head`. Core calls it as the node, because it spends the GitHub
      // connection, and attaches the answer to the task itself.
      .post('/', async (c) => {
        const parsed = changeRequestCreateInput.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success || !parsed.data.title.trim()) return respondError(c, 400, 'bad_request')
        const { taskId, ...input } = parsed.data
        if (!mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
        const task = await core.tasks.load(taskId)
        const project = task && (await core.projects.byId(task.projectId))
        if (!project?.github)
          return respondError(c, 400, 'bad_request', ['This task project is not connected to GitHub.'])
        const { owner, name } = project.github
        const result = await createPullRequest(await githubToken(c), db, ownerId(c), owner, name, input, emit)
        return result.ok
          ? c.json({ number: result.number })
          : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
      })
  )
}
