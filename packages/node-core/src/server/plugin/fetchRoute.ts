import type { Context, Next } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { resolvePluginFetch } from '../routeRegistry'
import { pluginRequestContext } from './requestContext'
import type { PluginFetchHandler } from './types'

// Adapt a host request to the portable `(Request, PluginRequestContext) -> Response` carrier. The
// mount is stripped so the handler observes the same relative path a router mounted with
// `app.route()` observes.
export async function servePluginFetch(
  c: Context<AppEnv>,
  args: { pluginId: string; mount: string; fetch: PluginFetchHandler },
): Promise<Response> {
  if (!c.get('principal')) return respondError(c, 401, 'unauthenticated')
  const raw = c.req.raw
  const url = new URL(raw.url)
  url.pathname = url.pathname.slice(args.mount.length) || '/'
  // Built field by field rather than `new Request(url, raw)`: handing a Request as the init bag reads
  // its body getter, and undici then demands `duplex` for the stream it finds there.
  const forwarded = new Request(url, {
    method: raw.method,
    headers: raw.headers,
    ...(raw.method === 'GET' || raw.method === 'HEAD' ? {} : { body: raw.body, duplex: 'half' }),
  } as RequestInit)
  return args.fetch(forwarded, pluginRequestContext(c, args.pluginId))
}

/** The one handler createApp mounts over `/v2/p/:plugin` and `/v2/p/:plugin/*` for every fetch-shaped
 * contribution there will ever be.
 *
 * A handler rather than a mount per contribution, because a reload replaces a plugin's entries in the
 * route registry while the app's mount table stays as it was built at boot: closing over
 * `contribution.fetch` made every request reach the previous instance
 * (routeRegistry.ts § resolvePluginFetch).
 *
 * Falls through with `next()` when no plugin claims the path, which is what makes it invisible: built-in
 * routers and the provider routes are registered earlier and answer first, and an unclaimed path reaches
 * the app's own 404 exactly as it did before. */
export const dispatchPluginFetch = async (c: Context<AppEnv>, next: Next): Promise<Response | void> => {
  const pluginId = c.req.param('plugin')
  const match = pluginId ? resolvePluginFetch(pluginId, c.req.path) : null
  if (!match || !pluginId) return next()
  return servePluginFetch(c, { pluginId, mount: match.mount, fetch: match.fetch })
}
