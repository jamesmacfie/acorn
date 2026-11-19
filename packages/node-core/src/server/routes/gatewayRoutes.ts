import type { Context } from 'hono'
import type { AppEnv } from '../middleware/auth'
import type { Disposable } from '../pluginHost/capabilities'

// `/v1/gateway/<plugin>/*`: the one door a hosted gateway of the account service has into this Node
// (docs/authentication/gateway-routes.md). It opens to a gateway token and nothing else, only through
// the relay, once per token. A compiled plugin serves it with `ctx.routes.gateway`; a loaded plugin has
// no such member, as it has no `loopback`.
//
// It's mounted before `requireUser`, because its caller holds no device or task token, and it answers
// every request under its prefix itself, so nothing reaches past it. The checks load on the first
// request (../auth/gateway.ts), so a Node nobody delivers to never carries them.

export const GATEWAY_NAMESPACE = '/v1/gateway'

/** Who a gateway request came from: the account service, for this Node's owner, on behalf of `plugin`. */
export type GatewayPrincipal = { kind: 'gateway'; plugin: string; accountId: string }
/** The request's path is relative to `/v1/gateway/<plugin>`. */
export type GatewayHandler = (request: Request, principal: GatewayPrincipal) => Response | Promise<Response>

const handlers = new Map<string, GatewayHandler>()

export function registerGatewayRoute(plugin: string, handler: GatewayHandler): Disposable {
  if (handlers.has(plugin)) throw new Error(`Plugin '${plugin}' already serves a gateway route.`)
  handlers.set(plugin, handler)
  return { dispose: () => void (handlers.get(plugin) === handler && handlers.delete(plugin)) }
}

export const hasGatewayRoute = (plugin: string): boolean => handlers.has(plugin)

export const serveGateway = async (c: Context<AppEnv>): Promise<Response> =>
  (await import('../auth/gateway')).serveGatewayRequest(c, handlers.get(c.req.param('plugin') ?? ''))
