import type { NodePlugin } from 'acorn-plugin-types'
import { alerts } from './feed'
import { hostsDescription, hostsSource, readHosts } from './hosts'

// scripts/manifest.mjs reads the feed and the hosts source from the build to write the manifest entries.
export { alerts, hostsSource }

type Raise = { nodeId: string; host: string; load: number; id?: string }

export default {
  // Must equal the manifest id.
  name: 'acme-alerts',
  init(ctx) {
    // #region raise
    // `acorn plugin acme-alerts raise` posts here, after the Node checks the input against the
    // manifest's schema. The Node refuses an agent on this path, because every trigger on the feed hears
    // an alert. Your own device can still post here directly, so the feed checks each event against its
    // schema. Raising the same id twice stores one event, so it starts one run.
    ctx.routes.fetch(async (request, context) => {
      const path = new URL(request.url).pathname
      // Every operation on the Host load source posts here, named by `operation`.
      if (request.method === 'POST' && path === '/sources/hosts') {
        const body = await request.json()
        if (body.operation === 'describe') return Response.json(hostsDescription)
        if (body.operation === 'query') return Response.json(await readHosts(ctx, body, context, request.signal))
        return new Response('unsupported operation', { status: 400 })
      }
      if (request.method !== 'POST' || path !== '/cli/raise') return new Response(null, { status: 404 })
      const { host, load, id } = (await request.json()) as Raise
      const time = Date.now()
      const stored = await alerts.append(ctx, [
        { id: id ?? crypto.randomUUID(), time, data: { host, load }, title: `${host} load ${load}` },
      ])
      // The feed says it changed on its own. The hosts read from it, so they changed too.
      if (stored) ctx.dataSources.changed('hosts')
      return Response.json({ stored })
    })
    // #endregion
  },
} satisfies NodePlugin
