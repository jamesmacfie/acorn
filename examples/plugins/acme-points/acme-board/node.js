// The board's cards, fixed data in memory, for the task pane, the rail source, and the card view. The host strips `/v1/p/acme-board`, so
// `/v1/p/acme-board/cards` arrives as `/cards`.
const CARDS = [
  { id: 'c1', title: 'Retry webhooks with backoff', column: 'Doing' },
  { id: 'c2', title: 'Add VAT to EU invoices', column: 'Review' },
]

export default {
  name: 'acme-board',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      const url = new URL(request.url)
      if (request.method !== 'GET') return new Response('not found', { status: 404 })
      // The rail source's rows. Picking one navigates to the card's route.
      if (url.pathname === '/cards') {
        return Response.json({ items: CARDS.map((card) => ({ id: card.id, title: card.title, subtitle: card.column })) })
      }
      const card = CARDS.find((candidate) => `/cards/${candidate.id}` === url.pathname)
      return card ? Response.json(card) : new Response('not found', { status: 404 })
    })
  },
}
