// What this plugin knows about the board, fixed data in memory. The host strips `/v1/p/acme-links`
// from every request.
const PULLS = [
  { id: 'pr-41', title: 'Retry webhook deliveries with backoff', subtitle: '#41 open' },
  { id: 'pr-43', title: 'Show VAT on EU invoices', subtitle: '#43 in review' },
]
const DEPLOYS = { c1: 'Deployed to staging', c2: 'Not deployed' }

export default {
  name: 'acme-links',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      const url = new URL(request.url)
      switch (`${request.method} ${url.pathname}`) {
        // #region rows
        // The rows under the board's task pane. The host draws them, so this answers display strings only.
        // The request names no card: rows belong to the pane, not to what it shows.
        case 'GET /links':
          return Response.json({ items: PULLS })
        // `onSelect`: the host posts the picked row's id as `item`.
        case 'POST /open': {
          const body = await request.json().catch(() => ({}))
          const pull = PULLS.find((candidate) => candidate.id === body.item)
          return pull ? Response.json({ ok: true }) : new Response('no such pull request', { status: 404 })
        }
        // #endregion
        // #region summary-route
        // What the summary tree reads for the card the board shows.
        case 'GET /deploys':
          return Response.json({ status: DEPLOYS[url.searchParams.get('card') ?? ''] ?? 'No deploys yet' })
        // #endregion
        default:
          return new Response('not found', { status: 404 })
      }
    })
  },
}
