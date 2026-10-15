// A week of deploy durations, in minutes, as fixed data. The host strips `/v1/p/acme-frame`, so
// `/v1/p/acme-frame/series` arrives as `/series`.
const SERIES = [12, 9, 14, 8, 7, 11, 6]

export default {
  name: 'acme-frame',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      const { pathname } = new URL(request.url)
      if (request.method === 'GET' && pathname === '/series') return Response.json({ label: 'Deploy minutes', points: SERIES })
      return new Response('not found', { status: 404 })
    })
  },
}
