import { Hono, type Context } from 'hono'
import { changeRequestCreateInput, type ChangeRequestFeedback } from '@acorn/protocol/plugin/contract.ts'
import { type AppEnv, mayActOnTask, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { gitlabSession, GITLAB_PROVIDER } from '../gitlabApi'
import { readDetail, readFilePaths } from '../mirror/detail'
import { mirroredProject, resolveProject } from '../mirror/projects'
import { checkFailed, checkPending } from '../mirror/vocabulary'
import { createMergeRequest } from '../createMergeRequest'
import { taskMergeRequest, type TaskCore } from '../taskMergeRequest'
import { fail } from './context'

// How many of each kind of feedback an agent gets, for the reason GitHub caps its own.
const FEEDBACK_LIMIT = 100

// The routes under this plugin's `codeHost.changeRequest.api`, which core's `pr` context section and
// `pr_*` agent tools call (docs/plugins/code-hosts.md § Agent context). The reads answer from the
// mirror, so none spends a credential, and a 404 means nothing is mirrored for that merge request.
export const changeRequestRoutes = (db: PluginDatabase, core: TaskCore) => {
  const mirrored = async (c: Context<AppEnv>) => {
    const taskId = c.req.query('taskId')
    const number = Number(c.req.param('number'))
    if (!taskId || !mayActOnTask(c, taskId) || !Number.isSafeInteger(number)) return null
    const key = await taskMergeRequest(db, core, ownerId(c), taskId, number)
    const detail = key && (await readDetail(db, key))
    return key && detail ? { key, detail } : null
  }

  return (
    new Hono<AppEnv>()
      .get('/:number', async (c) => {
        const found = await mirrored(c)
        if (!found?.detail.request) return respondError(c, 404, 'not_found')
        return c.json({
          number: found.key.iid,
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
          number: found.key.iid,
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
          number: found.key.iid,
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
      // Opens a merge request from `head`. Core calls it as the Node, because it spends the GitLab
      // connection, and attaches the answer to the task itself.
      .post('/', async (c) => {
        const parsed = changeRequestCreateInput.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success || !parsed.data.title.trim()) return respondError(c, 400, 'bad_request')
        const { taskId, ...input } = parsed.data
        if (!mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
        const task = await core.tasks.load(taskId)
        const repository = task && (await core.projects.byId(task.projectId))?.repository
        if (repository?.provider !== GITLAB_PROVIDER)
          return respondError(c, 400, 'bad_request', ['This task project is not on GitLab.'])
        const session = await gitlabSession(c)
        const resolved = await resolveProject(session, db, ownerId(c), repository.path)
        if (!resolved.ok) return fail(c, resolved.failure)
        const project = await mirroredProject(db, ownerId(c), resolved.value.path)
        const created = await createMergeRequest(
          session,
          { path: resolved.value.path, defaultBranch: project?.defaultBranch ?? null },
          input,
        )
        return created.ok ? c.json(created.value) : fail(c, created.failure)
      })
  )
}
