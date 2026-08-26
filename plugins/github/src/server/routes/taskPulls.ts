import { Hono } from 'hono'
import type { AppEnv, CoreServices } from '@acorn/plugin-api/node'
import { mayActOnTask, ownerId, respondError } from '@acorn/plugin-api/node'
import type { TaskPullRelation } from '../../contract/api'

// Durable Acorn-authored relations only. Stack and mention neighbours remain renderer-derived from
// GitHub's mirrored list/detail, so editing GitHub cannot leave stale task-owned rows behind.
export const taskPulls = (core: Pick<CoreServices, 'tasks'>) => new Hono<AppEnv>()
  .get('/:taskId/pulls', async (c) => {
    const taskId = c.req.param('taskId')
    if (!mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
    ownerId(c)
    if (!await core.tasks.load(taskId)) return respondError(c, 404, 'not_found')
    const pulls: TaskPullRelation[] = (await core.tasks.pulls(taskId)).map((relation) => ({
      pull: { owner: relation.repoOwner, repo: relation.repoName, number: String(relation.pullNumber) },
      role: relation.role,
      provenance: relation.provenance,
      sessionId: relation.sessionId,
      ...(relation.requestId ? { requestId: relation.requestId } : {}),
    }))
    return c.json({ pulls })
  })
