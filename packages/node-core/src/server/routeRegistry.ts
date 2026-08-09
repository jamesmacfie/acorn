import type { Hono } from 'hono'
import type { AppEnv } from './middleware/auth'
import type { PluginFetchHandler } from './plugin/types'

// The two current HTTP namespaces (docs/api-reference.md § HTTP conventions). Core owns
// `/v2/core/*`; every plugin gets `/v2/p/<plugin>/*`. Both live under the one `/v2/*` middleware
// envelope, so a route cannot be added outside the auth gate by choosing a prefix.
export const CORE_NAMESPACE = '/v2/core'
export const PLUGIN_NAMESPACE = '/v2/p'

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/

// Plugin-owned HTTP routers, projected into the app after the auth gate. A plugin server part
// contributes { plugin, prefix, router }; the app activation module (app/server/routes.ts) registers
// them before createApp() runs, and createApp() iterates this registry — core never imports a
// product route module directly (docs/plugins.md).
//
// `plugin` is DECLARED rather than parsed back out of the prefix: the effective mount is
// `/v2/p/${plugin}${prefix}`, so a later phase can enable/disable a plugin per node by filtering
// this registry on one field instead of pattern-matching URLs. `prefix` is whatever path the plugin
// wants under its own namespace — empty for a router that owns the whole namespace, `/tasks` for the
// task-scoped sub-resources. Distinct sub-paths mean registration order is not load-bearing.
//
// Two carriers, one mount. A built-in contributes a `router`; a LOADED plugin contributes a
// `fetch` handler, because a Hono instance is a live object from the plugin's realm and cannot
// cross the process boundary that rung 2 will put there (docs/security.md § Design
// rules). Everything downstream — the mount path, the auth envelope, per-plugin removal — is
// identical, which is the point: the transport changes later, the registry does not.
export type RouteContribution = { plugin: string; prefix: string; note?: string } & (
  | { router: Hono<AppEnv>; fetch?: never }
  | { fetch: PluginFetchHandler; router?: never }
)

export class RouteRegistry {
  readonly #contributions: RouteContribution[] = []

  register(contribution: RouteContribution): void {
    if (!PLUGIN_ID_RE.test(contribution.plugin)) {
      throw new Error(`Plugin route id must match ${PLUGIN_ID_RE.source}: '${contribution.plugin}'.`)
    }
    // Relative, and never re-stating the namespace: an absolute-looking '/v2/...' prefix would mount
    // at /v2/p/<plugin>/v2/... — silently unreachable rather than loudly wrong.
    if (contribution.prefix !== '' && !contribution.prefix.startsWith('/')) {
      throw new Error(`Plugin route prefix must be empty or start with '/': '${contribution.prefix}'.`)
    }
    if (contribution.prefix.startsWith('/v2')) {
      throw new Error(`Plugin route prefix is relative to ${PLUGIN_NAMESPACE}/<plugin>, so it must not repeat '/v2': '${contribution.prefix}'.`)
    }
    this.#contributions.push(contribution)
  }

  list(): readonly RouteContribution[] {
    return this.#contributions
  }

  // Drop everything a plugin previously contributed. The registry is a module singleton whose entries
  // arrive by side-effect import, which is fine for a process that boots once — but a plugin registers
  // its routes inside init(), and a process that starts the service TWICE (the tests do) would append a
  // second copy closing over the FIRST boot's database handle. Hono resolves to the first match, so the
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

export function registerRoute(contribution: RouteContribution): void {
  registry.register(contribution)
}

export function pluginRouteContributions(): readonly RouteContribution[] {
  return registry.list()
}

export function removePluginRoutes(plugin: string): void {
  registry.remove(plugin)
}
