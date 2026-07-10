import type { Hono } from 'hono'
import type { AppEnv } from './middleware/auth'

// Plugin-owned HTTP routers, projected into the app after the auth gate. A plugin server part
// contributes { prefix, router }; the app activation module (app/server/routes.ts) registers them
// before createApp() runs, and createApp() iterates this registry — core never imports a product
// route module directly (docs/next Phase 10 §4). Prefixes are the same Hono mount prefixes the
// hand-written table used; distinct sub-paths mean registration order is not load-bearing.
export type RouteContribution = { prefix: string; router: Hono<AppEnv>; note?: string }

const contributions: RouteContribution[] = []

export function registerRoute(contribution: RouteContribution): void {
  contributions.push(contribution)
}

export function pluginRouteContributions(): readonly RouteContribution[] {
  return contributions
}
