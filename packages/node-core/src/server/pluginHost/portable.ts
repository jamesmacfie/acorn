// The plugin side of the portable route carrier, as one helper instead of a paragraph every loaded
// plugin pasted out of the previous one.
//
// A loaded plugin serves `(Request, PluginRequestContext) -> Response` (types.ts § PluginFetchHandler)
// because a Hono instance cannot cross a process boundary. Plugins still want Hono, so all four of
// them had arrived at the same trick: hide the request context in `c.env` behind a symbol on the way
// in, and read it back out in each handler. Identical code, four copies, and the sort of code an
// author can only get identically right or subtly wrong.
//
// `servePluginFetch` (fetchRoute.ts) is the host half of the same carrier; this is what the plugin
// wraps its router in.
import type { Context, Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import type { PluginFetchHandler, PluginRequestContext } from './types'

// One symbol shared by every plugin, where each plugin used to mint its own. The symbol was never the
// protection. The context is the capability, and a plugin only ever holds the one the host handed to
// its own fetch handler. What the symbol buys is that a stray host binding cannot collide with it.
const PORTABLE_REQUEST_CONTEXT = Symbol('acorn-plugin-request-context')

type PortableBindings = AppEnv['Bindings'] & { [PORTABLE_REQUEST_CONTEXT]?: PluginRequestContext }

export type PortableCarrier = {
  /** The caller's identity and provider runtime, inside a handler. Throws if the router was mounted
   * some other way, which is a wiring bug and not something to answer a request through. */
  requestContext(c: Context<AppEnv>): PluginRequestContext
  /** Wrap the plugin's router in the shape `ctx.routes.fetch` takes. */
  portableFetch(routes: Hono<AppEnv>): PluginFetchHandler
}

/**
 * Both halves, bound to one plugin id so the failure names the plugin:
 *
 * ```ts
 * const { requestContext, portableFetch } = portableCarrier('linear')
 * // …handlers call requestContext(c)…
 * export const createLinearFetch = (): PluginFetchHandler => portableFetch(createLinearRoutes())
 * ```
 */
export function portableCarrier(plugin: string): PortableCarrier {
  return {
    requestContext: (c) => {
      const context = (c.env as PortableBindings)[PORTABLE_REQUEST_CONTEXT]
      if (!context) throw new Error(`${plugin} routes only run over the portable carrier (portableFetch)`)
      return context
    },
    portableFetch: (routes) => (request, context) =>
      routes.fetch(request, { [PORTABLE_REQUEST_CONTEXT]: context } as PortableBindings),
  }
}
