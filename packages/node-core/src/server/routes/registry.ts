import type { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import type { Disposable } from '../pluginHost/capabilities'
import type { PluginFetchHandler } from '../pluginHost/types'

// The two current HTTP namespaces (docs/api-reference/transport.md § Transport). Core owns
// `/v1/core/*`; every plugin gets `/v1/p/<plugin>/*`. Both live under the one `/v1/*` middleware
// envelope, so a route cannot be added outside the auth gate by choosing a prefix.
export const CORE_NAMESPACE = '/v1/core'
export const PLUGIN_NAMESPACE = '/v1/p'

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/

// Plugin-owned HTTP routers, projected into the app after the auth gate. A plugin contributes
// { plugin, prefix, router } through `ctx.routes` during init, before createApp() runs, and
// createApp() iterates this registry. Core never imports a product route module directly
// (docs/plugins.md).
//
// `plugin` is declared rather than parsed back out of the prefix: the effective mount is
// `/v1/p/${plugin}${prefix}`, so removing a plugin's routes filters this registry on one field
// instead of pattern-matching URLs. `prefix` is whatever path the plugin wants under its own
// namespace, empty for a router that owns the whole namespace, `/tasks` for the task-scoped
// sub-resources. Distinct sub-paths mean registration order is not load-bearing.
//
// Two carriers, one mount. A built-in contributes a `router`; a loaded plugin contributes a
// `fetch` handler, because a Hono instance is a live object from the plugin's realm and cannot
// cross the worker boundary (docs/security/plugin-storage-and-supply-chain.md § Design rules).
// Everything downstream, the mount path, the auth envelope, per-plugin removal, is identical.
export type RouteContribution = { plugin: string; prefix: string; note?: string } & (
  | { router: Hono<AppEnv>; fetch?: never }
  | { fetch: PluginFetchHandler; router?: never }
)

export class RouteRegistry {
  readonly #contributions: RouteContribution[] = []

  register(contribution: RouteContribution): Disposable {
    if (!PLUGIN_ID_RE.test(contribution.plugin)) {
      throw new Error(`Plugin route id must match ${PLUGIN_ID_RE.source}: '${contribution.plugin}'.`)
    }
    // Relative, and never re-stating the namespace: an absolute-looking '/v1/...' prefix would mount
    // at /v1/p/<plugin>/v1/..., silently unreachable rather than loudly wrong.
    if (contribution.prefix !== '' && !contribution.prefix.startsWith('/')) {
      throw new Error(`Plugin route prefix must be empty or start with '/': '${contribution.prefix}'.`)
    }
    if (contribution.prefix.startsWith('/v1')) {
      throw new Error(
        `Plugin route prefix is relative to ${PLUGIN_NAMESPACE}/<plugin>, so it must not repeat '/v1': '${contribution.prefix}'.`,
      )
    }
    this.#contributions.push(contribution)
    return {
      dispose: () => {
        const index = this.#contributions.indexOf(contribution)
        if (index >= 0) this.#contributions.splice(index, 1)
      },
    }
  }

  list(): readonly RouteContribution[] {
    return this.#contributions
  }

  // Drop everything a plugin previously contributed. The registry is a module singleton whose entries
  // arrive by side-effect import, which is fine for a process that boots once. A plugin registers its
  // routes inside init(), and a process that starts the service twice (the tests do) would append a
  // second copy closing over the first boot's database handle. Hono resolves to the first match, so the
  // second boot would serve every request from a closed database.
  remove(plugin: string): void {
    for (let i = this.#contributions.length - 1; i >= 0; i--) {
      if (this.#contributions[i].plugin === plugin) this.#contributions.splice(i, 1)
    }
  }
}

// The mount path createApp() hands to Hono for one contribution.
export function routeMountPath(contribution: RouteContribution): string {
  return `${PLUGIN_NAMESPACE}/${contribution.plugin}${contribution.prefix}`
}

const registry = new RouteRegistry()

export function registerRoute(contribution: RouteContribution): Disposable {
  return registry.register(contribution)
}

export function pluginRouteContributions(): readonly RouteContribution[] {
  return registry.list()
}

export function removePluginRoutes(plugin: string): void {
  registry.remove(plugin)
}

// The paths in a plugin's namespace that the host calls itself, in process, after checks of its own: a
// tool's handler after the tool tiers and ceiling, a CLI command's route after the device and schema
// checks, a source's handler after source admission. Over HTTP the plugin sees the same principal the
// host sends, so it can't tell a direct call from the host's, and `servePluginFetch` refuses an internal
// caller on these paths instead.
//
// Each registration that will dispatch a path reserves it here, and its undo releases it, so a reload
// or disable replaces the plugin's set along with its other registrations. `subtree` also covers every
// path below, for a code host's change request API, whose paths core builds from a number.
type HostDispatchedPath = { plugin: string; path: string; subtree: boolean }
const hostDispatched: HostDispatchedPath[] = []

// Compared in the loosest form a plugin's router might match: decoded the way Hono decodes, with
// repeated and trailing slashes dropped. A false match only refuses an agent, so loose is the safe way.
function comparablePath(path: string): string {
  let decoded = path
  try {
    decoded = decodeURI(path)
  } catch {
    // A malformed escape stays escaped in Hono too, so the raw form is what a router would compare.
  }
  return decoded.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')
}

export function reserveHostDispatchedPath(plugin: string, path: string, subtree = false): Disposable {
  // The base only turns a declared route, which may carry a query, into a pathname.
  const entry = { plugin, path: comparablePath(new URL(path, 'https://acorn.invalid').pathname), subtree }
  hostDispatched.push(entry)
  return {
    dispose: () => {
      const index = hostDispatched.indexOf(entry)
      if (index >= 0) hostDispatched.splice(index, 1)
    },
  }
}

export function isHostDispatchedPath(plugin: string, path: string): boolean {
  const candidate = comparablePath(path)
  return hostDispatched.some(
    (entry) =>
      entry.plugin === plugin &&
      (candidate === entry.path || (entry.subtree && candidate.startsWith(`${entry.path}/`))),
  )
}

/** Which fetch-shaped contribution should serve `path`, resolved at request time.
 *
 * The app mounts one dispatcher over the whole plugin namespace and asks here per request, so this
 * registry is the single source of truth about who serves what. A mount-time closure over
 * `contribution.fetch` would make the mount table a boot snapshot, and after a reload every request
 * would still reach the previous instance's handler. A prefix that only exists after a reload is
 * reachable, as is a plugin that contributed no routes at all when the app was built.
 *
 * Longest prefix wins, so a plugin owning both '' and '/tasks' gets the specific handler for
 * '/tasks/…'. That keeps registration order irrelevant, which is what `register` above promises. */
export function resolvePluginFetch(plugin: string, path: string): { mount: string; fetch: PluginFetchHandler } | null {
  let best: { mount: string; fetch: PluginFetchHandler } | null = null
  for (const contribution of registry.list()) {
    if (contribution.plugin !== plugin || !contribution.fetch) continue
    const mount = routeMountPath(contribution)
    // A segment boundary, never a bare startsWith: '/v1/p/a/tasks' must not be served by a '/task'
    // prefix, and the bare mount itself has to match because a plugin may own its whole namespace.
    if (path !== mount && !path.startsWith(`${mount}/`)) continue
    if (!best || mount.length > best.mount.length) best = { mount, fetch: contribution.fetch }
  }
  return best
}
