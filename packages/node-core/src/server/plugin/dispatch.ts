// Calling one of this node's own plugin routes with no client and no request in sight.
//
// Two callers need it: a manifest-declared schedule firing (./scheduleRun.ts) and the measure
// sampler reading a collection (../collections/registry.ts), and they needed the same six steps, so
// the steps live here once. It dispatches in process rather than over loopback HTTP: the listener is
// TLS with a self-signed certificate and its origin is a property of the composition root, so a
// self-call would mean teaching this module about certificates and ports to reach a handler sitting
// in the same heap. What the HTTP path contributes, the auth gate, the mount stripping, the request
// context, is reproduced here exactly, from the same two functions the route uses, so there is one
// plugin-route contract and not two.
//
// The principal is the node's own: 'internal' with the 'service' scope, which is what every other
// loopback caller presents and what `requireProviderAccess` already admits (docs/security.md §
// Credential handling). It is not task-scoped, since a schedule and a sampling pass belong to no
// task, and not a device, because nobody is here.
import type { Env } from '../../main/bindings'
import type { Principal } from '../middleware/auth'
import { PLUGIN_NAMESPACE, resolvePluginFetch } from '../routeRegistry'
import { buildPluginRequestContext } from './requestContext'

/** A base only the URL parser sees. Nothing is sent anywhere, so the origin exists purely to turn a
 *  path into a `URL`, and `.invalid` is the reserved TLD that guarantees it can never resolve. */
const IN_PROCESS_ORIGIN = 'https://acorn.invalid'

/** The device-side re-check, on the node. The manifest parser already confined a declared path, but
 *  the parser ran once against bytes on disk and this runs on every call. Confinement is the rule
 *  that stops a plugin making the host call core's routes, or another plugin's, on its behalf.
 *
 *  Throws rather than returning a flag: every caller's answer to a path outside the namespace is to
 *  fail the run, and a boolean nobody could sensibly ignore is a worse spelling of that. */
export function confinePluginPath(pluginId: string, path: string): URL {
  const own = `${PLUGIN_NAMESPACE}/${pluginId}/`
  const url = new URL(path, IN_PROCESS_ORIGIN)
  if (!path.startsWith('/') || url.origin !== IN_PROCESS_ORIGIN || !url.pathname.startsWith(own)) {
    throw new Error(`route must be inside ${own}`)
  }
  return url
}

export type PluginDispatchInit = {
  method: 'GET' | 'POST'
  /** JSON, serialized by the caller. Absent for a GET. */
  body?: string
}

/** Call a plugin's own route as this node. Returns the raw `Response`; status handling belongs to
 *  the caller, because "not ok" means different things to a schedule (fail and back off) and to a
 *  sampler (skip this panel, and say which source went missing). */
export async function dispatchPluginRoute(
  env: Env,
  pluginId: string,
  path: string,
  init: PluginDispatchInit,
  signal: AbortSignal,
): Promise<Response> {
  const url = confinePluginPath(pluginId, path)
  const match = resolvePluginFetch(pluginId, url.pathname)
  if (!match) throw new Error(`no route serves ${url.pathname}; the plugin may be disabled or may not have registered it`)

  const userId = env.ACTIVE_IDENTITY.get()
  if (!userId) throw new Error('this node has no bound identity, so an unattended run has nobody to run as')
  const principal: Principal = { kind: 'internal', userId, scope: 'service' }

  // Mount-relative, exactly as servePluginFetch hands it to an HTTP-served handler. The query string
  // rides along untouched, which is what makes a declared collection param reach the plugin as the
  // same string a client would have sent.
  const forwarded = new URL(url)
  forwarded.pathname = url.pathname.slice(match.mount.length) || '/'
  return match.fetch(
    new Request(forwarded, {
      method: init.method,
      ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: init.body }),
      signal,
    }),
    buildPluginRequestContext(env, principal, pluginId),
  )
}
