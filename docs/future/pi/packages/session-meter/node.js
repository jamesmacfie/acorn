import { nextEffort, taskActivity } from './meter.js'

// Relative imports and `node:` builtins only. This folder has no node_modules.
export default {
  name: 'acorn-session-meter',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    // Resolved per call, because agents may start after this plugin or be turned off.
    const agents = () => {
      const sessions = ctx.capabilities.get('agents.sessions')
      const activity = ctx.capabilities.get('agents.activity.v1')
      const control = ctx.capabilities.get('agents.sessionControl')
      return sessions && activity && control ? { sessions, activity, control } : null
    }

    // The mount is stripped, so `/v1/p/acorn-session-meter/activity` arrives as `/activity`.
    ctx.routes.fetch(async (request) => {
      const url = new URL(request.url)
      const found = agents()
      if (!found) return Response.json({ error: 'The agents plugin is not running.' }, { status: 503 })
      if (request.method === 'GET' && url.pathname === '/activity') {
        const taskId = url.searchParams.get('taskId')
        if (!taskId) return Response.json({ error: 'taskId is required' }, { status: 400 })
        return Response.json(await taskActivity(found, taskId))
      }
      if (request.method === 'POST' && url.pathname === '/cycle-effort') {
        const { taskId, sessionId } = await request.json()
        const entry = (await found.sessions.list(taskId)).find((session) => session.sessionId === sessionId)
        const next = entry ? nextEffort(entry.configOptions) : null
        if (!next) return Response.json({ error: 'This session has no reasoning effort to change.' }, { status: 409 })
        try {
          // The host binds this plugin's id, which the transcript names beside the change.
          await found.control.setConfig(taskId, sessionId, next.optionId, next.value)
        } catch (error) {
          return Response.json({ error: error?.message ?? String(error) }, { status: 409 })
        }
        return Response.json(next)
      }
      return new Response('not found', { status: 404 })
    })
  },
}
