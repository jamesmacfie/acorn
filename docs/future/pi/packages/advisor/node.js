import { createAdvisor } from './advisor.js'

// Relative imports and `node:` builtins only. This folder has no node_modules.
let advisor = null

export default {
  name: 'acorn-advisor',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    advisor = createAdvisor({
      db: ctx.storage.open().$client,
      reviewInput: () => ctx.capabilities.get('agents.reviewInput.v1'),
      turns: () => ctx.capabilities.get('agents.turns'),
      sessions: () => ctx.capabilities.get('agents.sessions'),
      tasks: ctx.core.tasks,
      git: ctx.core.git,
      models: ctx.core.models,
      identity: ctx.core.identity,
    })
    const failed = (error) => ctx.log.warn(`advisor: ${error?.message ?? error}`)

    // The sender agents binds to this plugin. Notes count against this plugin's own per-session cap.
    ctx.extensionPoints.handle('agents:session-messenger', {
      id: 'notes',
      value: { connect: (sender) => advisor.connect(sender) },
    })
    ctx.events.on('plugin:agents:turn-changed', (frame) => { try { advisor.turnChanged(frame) } catch (error) { failed(error) } })
    ctx.events.on('plugin:agents:sessions-changed', (frame) => { try { advisor.sessionsChanged(frame) } catch (error) { failed(error) } })

    // The settings tree's two calls. The mount is stripped, so `/v1/p/acorn-advisor/settings` arrives as `/settings`.
    ctx.routes.fetch(async (request) => {
      const { pathname } = new URL(request.url)
      if (pathname !== '/settings') return new Response('not found', { status: 404 })
      if (request.method === 'PUT') {
        const { mode } = await request.json()
        if (mode !== 'off' && mode !== 'interactive') return Response.json({ error: 'mode is off or interactive' }, { status: 400 })
        advisor.setMode(mode)
      }
      return Response.json(advisor.status())
    })
  },
  dispose() {
    advisor?.dispose()
  },
}
