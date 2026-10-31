import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { GUIDE_CONTEXT_MAX_CHARS } from '../shared/guide'
import { GuideError, type Guides } from './guides'
import { diffLineKeys } from './marks'

const failure = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, requestId: '', retryable: status >= 500 } }, { status })

// A model ID is a short catalog key. The harness drops one it doesn't offer, so this only bounds it.
const MODEL_MAX_CHARS = 200

/** An optional text field, trimmed. Null when it isn't a string or is longer than `max`. */
const optionalText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length <= max ? text : null
}

/** `GET /guide?taskId=`, `POST /guide/generate`, `POST /guide/stop`, and `POST /guide/progress`. Each
 *  answers the pane's view.
 *  `GET /profiles` answers the workflow step's harness choices, and `GET /backends` the pane's harness
 *  and model picker.
 *  `POST /marks` answers the code hosts' `diff-line` points with the guide's notes. */
export function createGuideFetch(guides: Guides): PluginFetchHandler {
  return async (request, context) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/profiles') {
      const profiles = await guides.profiles()
      return Response.json({ options: profiles.map((profile) => ({ value: profile.id, label: profile.label })) })
    }
    if (request.method === 'GET' && url.pathname === '/backends') {
      return Response.json({ backends: await guides.backends() })
    }
    const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}
    const { principal } = context
    if (request.method === 'POST' && url.pathname === '/marks') {
      const keys = diffLineKeys(body.keys)
      // A task's agent can call this too. Its credential names one task, so hold it to that task.
      if (principal.scope === 'task' && keys.some((key) => key.task !== principal.taskId))
        return failure(404, 'not_found', 'Not found.')
      // The host asks about one diff at a time, so a batch names one task, and its guide is read once.
      const byTask = Map.groupBy(keys, (key) => key.task)
      const marks = await Promise.all([...byTask].map(([taskId, taskKeys]) => guides.marks(taskId, taskKeys)))
      return Response.json({ items: marks.flat() })
    }
    const taskId = request.method === 'GET' ? url.searchParams.get('taskId') : body.taskId
    if (typeof taskId !== 'string' || !taskId) return failure(400, 'bad_request', 'Name a task.')
    // A task's agent can call these routes too. Its credential names one task, so hold it to that task.
    if (principal.scope === 'task' && taskId !== principal.taskId) return failure(404, 'not_found', 'Not found.')
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /guide':
          return Response.json(await guides.view(context.userId, taskId))
        case 'POST /guide/generate': {
          const profileId = typeof body.profileId === 'string' ? body.profileId : undefined
          const model = optionalText(body.model, MODEL_MAX_CHARS)
          if (model === null) return failure(400, 'bad_request', 'Name a model from the harness.')
          const focus = optionalText(body.context, GUIDE_CONTEXT_MAX_CHARS)
          if (focus === null)
            return failure(400, 'bad_request', `Keep the extra context to ${GUIDE_CONTEXT_MAX_CHARS} characters.`)
          return Response.json(
            await guides.generate(context.userId, taskId, {
              profileId,
              ...(model ? { model } : {}),
              ...(focus ? { context: focus } : {}),
            }),
          )
        }
        case 'POST /guide/stop':
          guides.stop(taskId)
          return Response.json(await guides.view(context.userId, taskId))
        case 'POST /guide/progress': {
          const { page, note, done } = body
          const named = typeof page === 'string' ? { page } : typeof note === 'string' ? { note } : null
          if (!named || (page !== undefined && note !== undefined) || typeof done !== 'boolean')
            return failure(400, 'bad_request', 'Name one page or one note, and say whether it is done.')
          return Response.json(await guides.markProgress(context.userId, taskId, { ...named, done }))
        }
        default:
          return failure(404, 'not_found', 'Not found.')
      }
    } catch (error) {
      if (error instanceof GuideError) return failure(error.status, 'guide_unavailable', error.message)
      throw error
    }
  }
}
