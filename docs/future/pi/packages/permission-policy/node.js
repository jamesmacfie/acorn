import { decide } from './policy.js'
import { createExplanations } from './explanations.js'

// Relative imports and `node:` builtins only. This folder has no node_modules.
export default {
  name: 'acorn-permission-policy',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    const explanations = createExplanations({
      db: ctx.storage.open().$client,
      requests: () => ctx.capabilities.get('agents.requests'),
    })
    const failed = (error) => ctx.log.warn(`explaining a refusal failed: ${error?.message ?? error}`)

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
        return Response.json(verdict)
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
