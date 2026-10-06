# Load plugin code on first use

Date: October 6, 2026. Status: proposal. Nothing in it is built.

This page proposes an opt-in helper that lets a plugin load a route's code on its first request
instead of at node boot. Read it before you add a heavy route to a compiled plugin, or before you
raise the service's size ceiling.

## The problem

The node service's build ends with a size check, `apps/node/scripts/check-service-budget.mjs`. It
counts `dist/service.js` and every chunk that file reaches through static imports, which is the code
a cold node reads and runs before it serves a request. The ceiling went from 2,910,000 B on
September 25, 2026 to 3,310,000 B on October 6, 2026.

On October 6, four rarely used paths moved to first use: workflow AI authoring, the Codex session
code, the dashboard sampler, and the plugin authoring renderer. The graph fell from 3,296,190 B to
3,099,374 B, and the ceiling dropped to 3,115,000 B. The commits are `c49476ca6`, `e07f72e69`, and
`ab2e800bb`, and `2f5e7d6d3` records the figures.

Those cuts treated symptoms. The cause is structural. Each plugin's `node/index.ts` statically
imports every router and service it registers, so each feature a plugin adds lands on the boot path
by default. The GitHub plugin's `node/index.ts` alone imports 17 route modules. Making all of them lazy would
remove up to 76,793 B, measured on October 6 by simulating the cut on the build's module graph.

Run `pnpm --filter @acorn/node measure:service-graph` to see what is in the graph. Add
`--why <path fragment>` to print the import chain that keeps a module there.

## Lazy routes are already possible

The plugin contract already allows lazy routes. `ctx.routes.fetch` takes an async handler, and the
host strips the mount prefix before the handler sees the path
(`packages/plugin-types/src/contracts/routes.ts`). The GitHub plugin uses this three times, in
`plugins/github/src/node/index.ts`:

```ts
let pullHandler: PluginFetchHandler | undefined
ctx.routes.fetch(async (request, context) => {
  pullHandler ??= (await import('../server/data/pullSourceHandler')).createPullSourceHandler()
  return pullHandler(request, context)
}, { prefix: '/data/pulls' })
```

This pattern has a race. Two requests that arrive before the first import settles both read
`pullHandler` as undefined, both build a handler, and the second one replaces the first. That is
harmless for a handler with no state. A handler that holds a cache, a connection, or a subscription
ends up with two copies. Copying the pattern into more plugins copies the race with it.

## Proposal: `lazyFetch`

Add one helper to `@acorn/plugin-api/node` (`packages/plugin-api/src/node.ts`):

```ts
export function lazyFetch<Conn, Items>(
  load: () => Promise<PluginFetchHandler<Conn, Items>>,
): PluginFetchHandler<Conn, Items> {
  let handler: Promise<PluginFetchHandler<Conn, Items>> | undefined
  return async (request, context) => {
    handler ??= load().catch((error) => {
      handler = undefined
      throw error
    })
    return (await handler)(request, context)
  }
}
```

The helper caches the promise, not the result, so concurrent first requests share one load. A load
that rejects clears the cache, so the next request retries instead of failing until a restart.

A plugin opts in one route at a time:

```ts
ctx.routes.fetch(lazyFetch(async () =>
  (await import('../server/data/pullSourceHandler')).createPullSourceHandler()), { prefix: '/data/pulls' })
```

A route that doesn't use the helper behaves exactly as it does today. Loaded plugins get the same
helper, because `ctx.routes.fetch` is the route method their tier is allowed to use.

## Lazy Hono routers

A route registered with `ctx.routes.register(router)` hands the host a live Hono router, so it has
to exist at boot. To make one lazy, build the router inside the lazily loaded module and return its
`fetch`:

```ts
ctx.routes.fetch(lazyFetch(async () => {
  const { mirrorRoutes } = await import('../server/routes/mirrorRoutes')
  return mirrorRoutes(store, ctx.core, emit).fetch
}), { prefix: '/repos', note: 'repository and pull request mirror' })
```

The GitHub mirror routers depend on their order. Several declare overlapping paths under `/repos`,
and Hono matches the first one registered. Moving all of them into one module that builds one app in
the same order keeps that order in one place, which is clearer than 13 ordered `register` calls.

The route list shows one entry per contribution. Thirteen routers behind one `fetch` show as one
entry, so give it a `note` that names what it serves.

## When to opt in

Opt a route in when both of these hold:

- `measure:service-graph` shows that its modules add about 10 KB or more to the graph, and nothing
  else on the boot path imports them.
- No request in a normal boot, and none in the first seconds after it, reaches the route.

Leave these at boot:

- Work `init` has to finish before the listener binds: migrations, stores, and anything `ready`
  depends on.
- The registrations that tell the node something exists: tool names and schemas, schedule keys, data
  source descriptors, and context sections. Their handlers can load lazily. The registration can't.
- Any module that registers something as a side effect of being imported. Making it lazy silently
  drops the registration. Move the registration into `init` first.

## Order of work

Do each step as its own commit.

1. **Add the helper.** Export `lazyFetch` from `packages/plugin-api/src/node.ts` and update
   `packages/plugin-api/src/surface.snapshot.txt`. Test it: two concurrent first requests call `load`
   once; a rejected load is retried by the next request; the handler receives the request and
   context unchanged.
2. **Convert the GitHub data handlers.** Replace the three hand-written handlers in
   `plugins/github/src/node/index.ts` with `lazyFetch`. Behavior doesn't change, and the race goes.
3. **Make the GitHub mirror lazy.** Move the `/repos` routers into one module that builds them in
   their current order, and register it with `lazyFetch`. Leave the `/tasks`, `/pins`, and `''`
   routers for a later pass. Run `measure:service-graph` before and after, and lower the ceiling in
   `check-service-budget.mjs` by what the cut saves.
4. **Document the helper.** Add a section on lazy routes to `docs/plugin-authoring/the-node-half.md`,
   covering the rules in [When to opt in](#when-to-opt-in), and link it from `docs/plugins/plugin-api.md`.
5. **Point the budget failure at the fix.** Change the error in `check-service-budget.mjs` to name
   `measure:service-graph --why` and `lazyFetch`.

Steps 2 and 3 are done when the GitHub plugin's tests pass, and when the pull request list, a pull
request's files and conflicts, and creating a pull request all work in `pnpm dev:agent`. Unit tests
that import a route module directly don't exercise the lazy load, so check the real app.

## Not proposed

- **A blanket rule that every route is lazy.** Most route modules are a few kilobytes. Splitting
  them all adds files and indirection for no measurable boot time.
- **A host-level contract such as `routes: () => import('./routes')`.** It would make laziness the
  default without each plugin opting in, but it changes the plugin contract. Revisit it if most
  plugins adopt `lazyFetch`.
- **Gating the build on boot time instead of bytes.** The budget script's own comment says boot time
  is the number to watch (`apps/desktop/test/boot.test.ts`). That is a separate decision.
- **Making `pg` or `jose` lazy.** Commit `c0c26af7b` measured them at 0.6 ms and under 0.1 ms to
  load and kept them static on purpose.

## Risks

- **Errors move from boot to first use.** The bundler resolves dynamic imports, so a missing file
  still fails the build. A module that throws while it loads fails on the first request instead of
  at boot, where every boot test would catch it.
- **The first request pays the load.** The first call to each lazy route waits for its import.
  Earlier lazy cuts measured a few milliseconds per module, small next to a GitHub API call.

## Verify before building

- Read `packages/node-core/src/server/pluginHost/fetchRoute.ts` and confirm that a handler that
  throws or rejects becomes a 500 with a logged error, not an unhandled rejection.
- Confirm how `createApp` orders router mounts against the fetch dispatcher
  (`packages/node-core/src/server/routes/registry.ts`). Moving the mirror from routers to `fetch`
  must not change which handler serves a path that both could match.
- Confirm that `PluginFetchHandler`'s generic parameters infer through the helper at the GitHub call
  sites without explicit type arguments.
- Re-run `measure:service-graph` before step 3. The 76,793 B figure predates later changes.
