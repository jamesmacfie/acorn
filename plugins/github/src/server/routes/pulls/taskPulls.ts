import { Hono } from 'hono'
import type { AppEnv, CoreServices } from '@acorn/plugin-api/node'
import { mayActOnTask, ownerId, respondError } from '@acorn/plugin-api/node'
import type { TaskPullRelation } from '../../../shared/api'

// Durable Acorn-authored relations only. Stack and mention neighbours remain client-derived from
// GitHub's mirrored list/detail, so editing GitHub cannot leave stale task-owned rows behind.
export const taskPulls = (core: Pick<CoreServices, 'tasks'>) =>
  new Hono<AppEnv>().get('/:taskId/pulls', async (c) => {
    const taskId = c.req.param('taskId')
    if (!mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
    ownerId(c)
    if (!(await core.tasks.load(taskId))) return respondError(c, 404, 'not_found')
    const pulls: TaskPullRelation[] = (await core.tasks.changeRequests(taskId)).flatMap((request) => {
      const [owner, repo, ...rest] = request.path.split('/')
      if (request.host !== 'github.com' || request.provenance !== 'agent' || !request.sessionId) return []
      if (!owner || !repo || rest.length) return []
      return [
        {
          pull: { owner, repo, number: String(request.number) },
          role: request.role,
          provenance: 'agent' as const,
          sessionId: request.sessionId,
          ...(request.requestId ? { requestId: request.requestId } : {}),
        },
      ]
    })
    return c.json({ pulls })
  })
