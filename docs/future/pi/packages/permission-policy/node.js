import { decide } from './policy.js'

// Relative imports and `node:` builtins only. This folder has no node_modules.
export default {
  name: 'acorn-permission-policy',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    // The host posts the `agents:before-permission` payload here and reads `{ ok, reason? }` back. The
    // mount is stripped, so `/v1/p/acorn-permission-policy/before-permission` arrives as `/before-permission`.
    ctx.routes.fetch(async (request) => {
      const { pathname } = new URL(request.url)
      if (request.method !== 'POST' || pathname !== '/before-permission') return new Response('not found', { status: 404 })
      return Response.json(decide(await request.json()))
    })
  },
}
