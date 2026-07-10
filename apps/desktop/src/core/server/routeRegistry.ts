import type { Hono } from 'hono'
import type { AppEnv } from './middleware/auth'

// Plugin-owned HTTP routers, projected into the app after the auth gate. A plugin server part
// contributes { prefix, router }; the app activation module (app/server/routes.ts) registers them
// before createApp() runs, and createApp() iterates this registry — core never imports a product
// route module directly (docs/next Phase 10 §4). Prefixes are the same Hono mount prefixes the
// hand-written table used; distinct sub-paths mean registration order is not load-bearing.
export type RouteContribution = { prefix: string; router: Hono<AppEnv>; note?: string }

export class RouteRegistry {
  readonly #contributions: RouteContribution[] = []

  register(contribution: RouteContribution): void {
    if (contribution.prefix !== '/api' && !contribution.prefix.startsWith('/api/')) {
      throw new Error(`Plugin route prefix must stay inside the authenticated /api namespace: '${contribution.prefix}'.`)
    }
    this.#contributions.push(contribution)
  }

  list(): readonly RouteContribution[] {
    return this.#contributions
  }
}

const registry = new RouteRegistry()

export function registerRoute(contribution: RouteContribution): void {
  registry.register(contribution)
}

export function pluginRouteContributions(): readonly RouteContribution[] {
  return registry.list()
}
