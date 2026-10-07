import { createTestFirst, decide, warn } from './policy.js'
import { createExplanations } from './explanations.js'

// Relative imports and `node:` builtins only. This folder has no node_modules.
export default {
  name: 'acorn-permission-policy',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    const explanations = createExplanations({
      db: ctx.storage.open().$client,
      requests: () => ctx.capabilities.get('agents.requests'),
      log: (line) => ctx.log.info(line),
    })
    const failed = (error) => ctx.log.warn(`explaining a refusal failed: ${error?.message ?? error}`)
    // Warnings for requests the rules let through, by `<sessionId>:<requestId>`, for the request card to
    // read. In memory: a Node restart ends the harness process, and with it every pending request.
    const warnings = new Map()
    const testFirst = createTestFirst()

    // The sender agents binds to this plugin. Kept past `connect`, and replaced when agents reconnects.
    ctx.extensionPoints.handle('agents:session-messenger', {
      id: 'explanations',
      value: { connect: (sender) => void explanations.connect(sender).catch(failed) },
    })
    ctx.events.on('plugin:agents:request-changed', (frame) => void explanations.requestChanged(frame).catch(failed))

    // The mount is stripped, so `/v1/p/acorn-permission-policy/before-permission` arrives as `/before-permission`.
    ctx.routes.fetch(async (request) => {
      const { pathname } = new URL(request.url)
      if (request.method === 'POST' && pathname === '/before-permission') {
        // The host reads `{ ok, reason? }` back. A refusal is only recorded here; nothing is sent until
        // the resolved request shows the veto took effect (explanations.js).
        const payload = await request.json()
        const verdict = decide(payload)
        if (!verdict.ok) explanations.refused(payload)
        const warning = verdict.ok ? warn(payload) : null
        if (warning) {
          warnings.set(`${payload.sessionId}:${payload.requestId}`, warning)
          // A fixed cap, oldest first; a pending request older than 200 others has lost its note.
          if (warnings.size > 200) warnings.delete(warnings.keys().next().value)
        }
        return Response.json(verdict)
      }
      // A bridged harness's tool call (docs/managed-agents/loop-hooks.md). The same rules on the same
      // subject: a refusal reaches the model inside the turn, so there's nothing to explain later.
      if (request.method === 'POST' && pathname === '/before-tool') {
        return Response.json(decide(await request.json()))
      }
      // What only warns on a permission card holds a bridged call for the person instead.
      if (request.method === 'POST' && pathname === '/before-tool-ask') {
        const reason = warn(await request.json())
        return Response.json(reason ? { ask: true, reason } : { ask: false })
      }
      if (request.method === 'POST' && pathname === '/after-tool') {
        const payload = await request.json()
        const note = testFirst(payload)
        return Response.json({ payload: note ? { ...payload, note } : payload })
      }
      // The request card's note (client.js).
      if (pathname === '/warning' && request.method === 'GET') {
        const query = new URL(request.url).searchParams
        return Response.json({ warning: warnings.get(`${query.get('sessionId')}:${query.get('requestId')}`) ?? null })
      }
            // The palette's "explain refusals" setting: GET reads it, PUT writes `{ value }`.
      if (pathname === '/settings/explain' && request.method === 'GET') {
        return Response.json({ value: explanations.enabled() ? 'on' : 'off' })
      }
      if (pathname === '/settings/explain' && request.method === 'PUT') {
        const { value } = await request.json()
        if (value !== 'on' && value !== 'off') return Response.json({ error: 'value is on or off' }, { status: 400 })
        explanations.setEnabled(value === 'on')
        return Response.json({ value })
      }
      return new Response('not found', { status: 404 })
    })
  },
}
