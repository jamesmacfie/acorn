import type { Context } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
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
