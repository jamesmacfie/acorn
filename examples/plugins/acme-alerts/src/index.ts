import type { NodePlugin } from 'acorn-plugin-types'
import { alerts } from './feed'

// scripts/manifest.mjs reads the feed from the build to write the manifest entry.
export { alerts }

type Raise = { nodeId: string; host: string; load: number; id?: string }

export default {
  // Must equal the manifest id.
  name: 'acme-alerts',
  init(ctx) {
    // #region raise
    // `acorn plugin acme-alerts raise` posts here, after the Node checks the input against the
    // manifest's schema. Raising the same id twice stores one event, so it starts one run.
    ctx.routes.fetch(async (request) => {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/cli/raise')
        return new Response(null, { status: 404 })
      const { host, load, id } = (await request.json()) as Raise
      const time = Date.now()
      const stored = await alerts.append(ctx, [
        { id: id ?? crypto.randomUUID(), time, data: { host, load }, title: `${host} load ${load}` },
      ])
      return Response.json({ stored })
    })
    // #endregion
  },
} satisfies NodePlugin
