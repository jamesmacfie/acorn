import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import type { PreviewUnavailable } from '../transport/preview/previewControl'
import { respondError } from '../respond'

// `ctx.routes.loopback` (docs/plugins/plugin-api.md § Loopback routes): a route that shows one of this Node's
// loopback ports to a paired device, such as a task's dev server. The plugin says which port. Everything
// that makes it safe is here, in proxy/loopbackProxy.ts and in the gate below, so a plugin can't loosen it.

export type LoopbackRouteOptions = {
  /** Where it mounts under the plugin's namespace, such as `/tasks/:taskId/proxy`. */
  prefix: string
  /** The port on this computer's loopback for a request's path parameters, or null when there is none. */
  target(params: Record<string, string>): Promise<number | null>
  note?: string
}

// The page that will frame a preview: an origin, with no path, wildcard, or anything a policy could be
// made to read as a second directive.
const openBody = z.strictObject({
  ancestor: z
    .string()
    .regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/)
    .optional(),
})

// Why a preview can't open, for a person. The reason itself rides in the error's details for a client to act on.
const UNAVAILABLE: Record<PreviewUnavailable, string> = {
  off: 'Turn on Remote access on this Node to see previews on a phone.',
  unsupported: 'The account service this Node uses has no preview domain.',
  starting: 'This Node is still getting its certificate for previews. Try again in a minute.',
  expired: "This Node's certificate for previews ran out and couldn't be renewed.",
}

// Serve one request to a loopback route. The route is mounted by the plugin host as a bare `/*` handler that
// loads this module on its first request, so a Node that never shows a port carries none of it.
export async function serveLoopback(
  c: Context<AppEnv>,
  mount: string,
  target: LoopbackRouteOptions['target'],
): Promise<Response> {
  // Only a paired device. A task's token gets 403, so an agent can't put a page of its own in front of the
  // owner, and the Node's own service has no business here either.
  const denied = await requireDevice(c, async () => {})
  if (denied) return denied
  const params = c.req.param()
  const port = await target(params)
  if (port === null) return respondError(c, 404, 'no_preview')

  // A phone's browser can't send a device token, so it asks for an address it can load by itself.
  if (c.req.method === 'POST' && c.req.path === `${mountWith(mount, params)}/__acorn/open`) {
    const body = openBody.safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return respondError(c, 400, 'bad_request')
    const opened = c.env.PREVIEWS?.open({
      deviceId: c.get('principal')?.deviceId,
      ancestor: body.data.ancestor,
      port: () => target(params),
    }) ?? { unavailable: 'off' as const }
    return 'url' in opened
      ? c.json({ url: opened.url })
      : respondError(c, 503, 'preview_unavailable', [UNAVAILABLE[opened.unavailable]], { reason: opened.unavailable })
  }

  // The Node's own port is the listener's. A request that came by another route, the phone's channel, has no
  // socket to read it from, and has no business proxying either.
  const ownPort = c.env.incoming?.socket.localPort
  if (!ownPort) return respondError(c, 501, 'proxy_unavailable')
  const { proxyHttp, proxyUpgrade } = await import('./loopbackProxy')
  const options = { port, ownPort, publicOrigin: c.req.header('origin') ?? '', mount: mountWith(mount, params) }
  // A dev server's live reload socket. The caller is a paired device, such as the desktop's helper, which
  // holds the token a page can't send and checks the page's origin itself.
  const upgrade = c.env.upgrade
  if (upgrade) {
    upgrade.taken = true
    await proxyUpgrade(c.env.incoming!, upgrade.socket, upgrade.head, options)
    return c.body(null)
  }
  return proxyHttp(c.req.raw, options)
}

// The mount with this request's parameters filled in, which is the part of the path the app never sees.
const mountWith = (mount: string, params: Record<string, string>): string =>
  mount.replace(/:(\w+)/g, (_, name: string) => params[name] ?? '')
