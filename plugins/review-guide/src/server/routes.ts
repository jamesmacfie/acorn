import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { GuideError, type Guides } from './guides'

const failure = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, requestId: '', retryable: status >= 500 } }, { status })

/** `GET /guide?taskId=`, `POST /guide/generate`, and `POST /guide/stop`. Each answers the pane's view.
 *  `GET /profiles` answers the workflow step's harness choices. */
export function createGuideFetch(guides: Guides): PluginFetchHandler {
  return async (request, context) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/profiles') {
      const profiles = await guides.profiles()
      return Response.json({ options: profiles.map((profile) => ({ value: profile.id, label: profile.label })) })
    }
    const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}
    const taskId = request.method === 'GET' ? url.searchParams.get('taskId') : body.taskId
    if (typeof taskId !== 'string' || !taskId) return failure(400, 'bad_request', 'Name a task.')
    // A task's agent can call these routes too. Its credential names one task, so hold it to that task.
    const { principal } = context
    if (principal.scope === 'task' && taskId !== principal.taskId) return failure(404, 'not_found', 'Not found.')
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /guide':
          return Response.json(await guides.view(context.userId, taskId))
        case 'POST /guide/generate': {
          const profileId = typeof body.profileId === 'string' ? body.profileId : undefined
          return Response.json(await guides.generate(context.userId, taskId, profileId))
        }
        case 'POST /guide/stop':
          guides.stop(taskId)
          return Response.json(await guides.view(context.userId, taskId))
        default:
          return failure(404, 'not_found', 'Not found.')
      }
    } catch (error) {
      if (error instanceof GuideError) return failure(error.status, 'guide_unavailable', error.message)
      throw error
    }
  }
}
