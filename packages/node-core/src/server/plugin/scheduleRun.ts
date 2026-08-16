// What a MANIFEST-declared schedule actually does when it fires (docs/schedules.md).
//
// A loaded plugin declares periodic work as a route rather than as a function, because a manifest is
// data and a manifest is what the owner is shown at install. So the node has to call one of its own
// plugin routes with no client and no request in sight.
//
// It dispatches IN PROCESS rather than over loopback HTTP. The listener is TLS with a self-signed
// certificate and its origin is a property of the composition root, so a self-call would mean teaching
// this module about certificates and ports to reach a handler that is sitting in the same heap. What
// the HTTP path contributes — the auth gate, the mount stripping, the request context — is reproduced
// here exactly, from the same two functions the route uses (routeRegistry.resolvePluginFetch and
// requestContext.buildPluginRequestContext), so there is one plugin-route contract and not two.
//
// The principal is the node's own: 'internal' with the 'service' scope, which is what every other
// loopback caller presents and what `requireProviderAccess` already admits. It is deliberately NOT
// task-scoped — a schedule belongs to no task — and deliberately not a device, because nobody is here.
import type { Env } from '../../main/bindings'
import type { PluginScheduleDescriptor } from '../../main/pluginManifest'
import type { Principal } from '../middleware/auth'
import { PLUGIN_NAMESPACE, resolvePluginFetch } from '../routeRegistry'
import { buildPluginRequestContext } from './requestContext'

/** How much of a plugin's answer reaches the run row. A schedule is not a data channel: the response is
 *  ignored beyond ok/error, and this exists only so a failing one can say why on the settings page. */
const DETAIL_MAX = 200

/** Run one manifest-declared schedule. Throws on anything that is not a 2xx, because throwing is how the
 *  engine records a failure and starts backing off. */
export async function runPluginScheduleRoute(
  env: Env,
  pluginId: string,
  descriptor: PluginScheduleDescriptor,
  signal: AbortSignal,
): Promise<string | void> {
  // The device-side re-check, on the node. The manifest parser already confined this path, but the
  // parser ran once against bytes on disk and this runs on every fire — and confinement is the rule that
  // stops a plugin making the host call core's routes, or another plugin's, on its behalf.
  const own = `${PLUGIN_NAMESPACE}/${pluginId}/`
  const url = new URL(descriptor.run, 'https://acorn.invalid')
  if (!descriptor.run.startsWith('/') || url.origin !== 'https://acorn.invalid' || !url.pathname.startsWith(own)) {
    throw new Error(`schedule route must be inside ${own}`)
  }

  const match = resolvePluginFetch(pluginId, url.pathname)
  if (!match) throw new Error(`no route serves ${url.pathname}; the plugin may be disabled or may not have registered it`)

  const userId = env.ACTIVE_IDENTITY.get()
  if (!userId) throw new Error('this node has no bound identity, so a scheduled run has nobody to run as')
  const principal: Principal = { kind: 'internal', userId, scope: 'service' }

  // Mount-relative, exactly as servePluginFetch hands it to an HTTP-served handler.
  const forwarded = new URL(url)
  forwarded.pathname = url.pathname.slice(match.mount.length) || '/'
  const response = await match.fetch(
    new Request(forwarded, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduleId: descriptor.id }),
      signal,
    }),
    buildPluginRequestContext(env, principal, pluginId),
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`${response.status} from ${url.pathname}${body ? `: ${body.slice(0, DETAIL_MAX)}` : ''}`)
  }
}
