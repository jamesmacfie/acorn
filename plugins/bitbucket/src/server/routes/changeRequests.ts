import { Hono, type Context } from 'hono'
import { changeRequestCreateInput, type ChangeRequestFeedback } from '@acorn/protocol/plugin/contract.ts'
import { type AppEnv, mayActOnTask, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { bitbucketSession, BITBUCKET_PROVIDER } from '../bitbucketApi'
import { readDetail, readFilePaths } from '../mirror/detail'
import { resolveRepository } from '../mirror/repositories'
import { checkFailed, checkPending } from '../mirror/vocabulary'
import { createPullRequest } from '../createPullRequest'
import { taskPullRequest, type TaskCore } from '../taskPullRequest'
import { fail } from './context'
import type { BitbucketAccount } from '../account'

// How many of each kind of feedback an agent gets, for the reason GitHub caps its own.
const FEEDBACK_LIMIT = 100

// The routes under this plugin's `codeHost.changeRequest.api`, which core's `pr` context section and
// `pr_*` agent tools call (docs/plugins/code-hosts.md § Agent context). The reads answer from the
// mirror, so none spends a credential, and a 404 means nothing is mirrored for that pull request.
export const changeRequestRoutes = (db: PluginDatabase, core: TaskCore, account: BitbucketAccount) => {
  const mirrored = async (c: Context<AppEnv>) => {
    const taskId = c.req.query('taskId')
    const number = Number(c.req.param('number'))
    if (!taskId || !mayActOnTask(c, taskId) || !Number.isSafeInteger(number)) return null
    const key = await taskPullRequest(core, account, taskId, number)
    const detail = key && (await readDetail(db, key))
    return key && detail ? { key, detail } : null
  }

  return (
    new Hono<AppEnv>()
      .get('/:number', async (c) => {
        const found = await mirrored(c)
        if (!found?.detail.request) return respondError(c, 404, 'not_found')
        return c.json({
          number: found.key.number,
          title: found.detail.request.title,
          body: found.detail.request.body,
          changedFiles: (await readFilePaths(db, found.key)).sort(),
        })
      })
      .get('/:number/checks', async (c) => {
        const found = await mirrored(c)
        if (!found?.detail.checks.length) return respondError(c, 404, 'not_found')
        const checks = [...found.detail.checks].sort((a, b) => a.name.localeCompare(b.name))
        return c.json({
          number: found.key.number,
          checks,
          failing: checks.filter((check) => checkFailed(check.status)).map((check) => check.name),
          pending: checks.filter((check) => checkPending(check.status)).map((check) => check.name),
        })
      })
      .get('/:number/feedback', async (c) => {
        const found = await mirrored(c)
        if (!found) return respondError(c, 404, 'not_found')
        const includeResolved = c.req.query('includeResolved') === 'true'
        const { reviews, comments } = found.detail
        const threads = found.detail.threads.filter((thread) => includeResolved || !thread.resolved)
        const feedback: ChangeRequestFeedback = {
          number: found.key.number,
          reviews: reviews.slice(0, FEEDBACK_LIMIT).map((review) => ({
            author: review.author,
            state: review.state,
            body: review.body,
            submittedAt: review.submittedAt,
          })),
          threads: threads.slice(0, FEEDBACK_LIMIT).map((thread) => ({
            threadId: thread.threadId,
            path: thread.path,
            line: thread.line,
            originalLine: thread.originalLine ?? null,
            outdated: thread.outdated ?? null,
            side: thread.side,
            resolved: thread.resolved,
            comments: thread.comments.map(({ author, body, createdAt }) => ({ author, body, createdAt })),
          })),
          comments: comments
            .slice(0, FEEDBACK_LIMIT)
            .map(({ author, body, createdAt }) => ({ author, body, createdAt })),
          omitted: [reviews.length, threads.length, comments.length].reduce(
            (total, count) => total + Math.max(0, count - FEEDBACK_LIMIT),
            0,
          ),
        }
        return c.json(feedback)
      })
      // Opens a pull request from `head`. Core calls it as the Node, because it spends the Bitbucket
      // connection, and attaches the answer to the task itself.
      .post('/', async (c) => {
        const parsed = changeRequestCreateInput.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success || !parsed.data.title.trim()) return respondError(c, 400, 'bad_request')
        const { taskId, ...input } = parsed.data
        if (!mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
        const task = await core.tasks.load(taskId)
        const repository = task && (await core.projects.byId(task.projectId))?.repository
        if (repository?.provider !== BITBUCKET_PROVIDER)
          return respondError(c, 400, 'bad_request', ['This task project is not on Bitbucket.'])
        const connectionId = account.connectionId()
        const session = connectionId ? await bitbucketSession(c, connectionId) : null
        if (!connectionId || !session?.auth) return respondError(c, 401, 'reauth')
        const resolved = await resolveRepository(session, db, connectionId, repository.path)
        if (!resolved.ok) return fail(c, resolved.failure)
        const created = await createPullRequest(session, resolved.value, input)
        return created.ok ? c.json(created.value) : fail(c, created.failure)
      })
  )
}
