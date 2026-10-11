// Routes whose code loads on their first request instead of at node boot
// (docs/plugin-authoring/the-node-half.md § Load a route on first use).
//
// The registration still happens in `init`, so the route exists, sits behind the same auth gate, and
// keeps its place in the mount order. Only the module behind it, and whatever that module imports,
// waits until a request arrives. The node build counts what boot imports statically
// (apps/node/scripts/check-service-budget.mjs), so this is how a large, rarely used route leaves it.
import { type Context, Hono, type Next } from 'hono'
import { basePath } from 'hono/route'
import type { AppEnv } from '../middleware/auth'
import type { PluginFetchHandler } from './types'

/** A lazy route's module or factory threw on its first use. The request still gets the usual 500
 * envelope from onServerError, which logs only an error's name and the path, so the name is what tells
 * a load failure apart from a handler that threw. The original error is the `cause`. */
export class LazyRouteLoadError extends Error {
  override name = 'LazyRouteLoadError'
}

// One load shared by every caller, so two requests that arrive before the import settles build one
// handler, not two. A rejected load clears itself, so the next request retries instead of failing
// until a restart.
function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined
  return () =>
    (loading ??= load().catch((cause: unknown) => {
      loading = undefined
      throw new LazyRouteLoadError('A route failed to load on first use', { cause })
    }))
}

/** A fetch handler for `ctx.routes.fetch` that loads on its first request:
 *
 * ```ts
 * ctx.routes.fetch(lazyFetch(async () =>
 *   (await import('../server/data/pullSourceHandler')).createPullSourceHandler()), { prefix: '/data/pulls' })
 * ```
 */
export function lazyFetch(load: () => Promise<PluginFetchHandler>): PluginFetchHandler {
  const handler = loadOnce(load)
  return async (request, context) => (await handler())(request, context)
}

/** A compiled plugin's Hono router for `ctx.routes.register` that is built on its first request:
 *
 * ```ts
 * ctx.routes.register(lazyRouter(async () =>
 *   (await import('../server/routes/mirrorRoutes')).mirrorRoutes(store, ctx.core, emit)), { prefix: '/repos' })
 * ```
 *
 * The loaded router runs with the host's request, as if it had been mounted at boot: the same
 * principal, request id, trace and bindings, the same path and parameters, and its errors reach the
 * app's error handler. A path the loaded router doesn't serve falls through to whatever the app
 * would have tried next. `lazyFetch` can't do this for a compiled router, because the fetch carrier
 * hands a handler a plugin request context and none of the host's bindings. */
export function lazyRouter(load: () => Promise<Hono<AppEnv>>): Hono<AppEnv> {
  const router = loadOnce(load)
  // The loaded router runs inside a second Hono app, which starts each request with a fresh context.
  // These carry the outer request's variables in, and the inner app's "no route matched" back out.
  const carried = new WeakMap<Request, AppEnv['Variables']>()
  const unmatched = new WeakSet<Request>()
  // One inner app per mount, because the inner app has to match the full path the outer one saw.
  const mounted = new Map<string, Hono<AppEnv>>()
  const mountedAt = (base: string, loaded: Hono<AppEnv>): Hono<AppEnv> => {
    let app = mounted.get(base)
    if (!app) {
      app = new Hono<AppEnv>()
        .use(async (c, next) => {
          for (const [key, value] of Object.entries(carried.get(c.req.raw) ?? {}))
            c.set(key as keyof AppEnv['Variables'], value as never)
          await next()
        })
        .route(base, loaded)
        .notFound((c) => {
          unmatched.add(c.req.raw)
          return c.body(null, 404)
        })
        // Rethrown so the error reaches the outer app's onServerError with the outer context, the
        // same as a handler in a router mounted at boot.
        .onError((error) => {
          throw error
        })
      mounted.set(base, app)
    }
    return app
  }

  const serve = async (c: Context<AppEnv>, next: Next): Promise<Response | void> => {
    const app = mountedAt(basePath(c), await router())
    const raw = c.req.raw
    // A middleware that already read the body, such as idempotency hashing it, leaves the stream
    // used, so the copy Hono kept goes in its place (fetchRoute.ts § servePluginFetch does the same).
    const request = raw.bodyUsed
      ? new Request(raw.url, {
          method: raw.method,
          headers: raw.headers,
          signal: raw.signal,
          body: await c.req.arrayBuffer(),
        })
      : raw
    carried.set(request, c.var)
    const response = await app.fetch(request, c.env)
    if (unmatched.has(request)) return next()
    return response
  }
  // The Hono this repo pins matches the bare mount path with `/*` too. A second `/` route would run an
  // unmatched bare path twice. lazyRoutes.test.ts serves `/` and fails if an upgrade changes this.
  return new Hono<AppEnv>().all('/*', serve)
}
