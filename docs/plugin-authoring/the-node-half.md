# The node half

This page covers a loaded plugin's node entrypoint: how the Node loads it, what its default export
must look like, and the `ctx` members it gets. It's part of [plugin authoring](../plugin-authoring.md).

## The node half

The loader resolves `manifest.node` inside the package directory and imports it
(`server/plugins/loader.ts`). Node resolves your relative imports itself, so multi-file plain ESM
needs no build step. The entrypoint runs in a permission-scoped worker, and the Node refuses to load
plugins on a Node release below `>=22.23.2 <23 || >=24.18.1 <25 || >=26.5.1 <27`.

Use relative paths and `node:` builtins only. A bare specifier such as `hono`, `zod`, or `drizzle-orm`
has nothing to resolve against, because an installed package is a bare directory with no
`node_modules`. A repository plugin can use them only because the builder bundles them. Bundle any
runtime dependency into your own files before you install.

Node's resolution walks parent directories looking for `node_modules`, and a development data root
sits inside the repository, where a parent has one. So a bare specifier can work on the machine that
wrote it and fail everywhere else. "It worked in dev" isn't evidence here.

The default export must pass `asNodePlugin`, a structural check, not `instanceof`, because a separately
compiled bundle's classes are its own:

```js
export default {
  name: '<must equal the manifest id>',   // string, required
  init(ctx) {},                            // function, required, may be async
  ready(ctx) {},                           // optional; runs after every plugin's init
  dispose() {},                            // optional
}
```

The load fails when `plugin.name` doesn't equal `manifest.id`. The host binds every namespace from the
manifest, so a mismatch means the package contradicts itself, and the loader doesn't pick a winner.

## What ctx has

A loaded plugin's `ctx` has no `routes.register`, `tools`, `contextSections`, `search`,
`events.channel`, or `events.streams`, whatever the manifest says. That's the difference between the
`NodePluginContext` and `CompiledNodePluginContext` types, so your editor shows the error if you
annotate `ctx` with `acorn-plugin-types` ([the two contexts](../plugins/plugin-api.md#the-two-contexts-one-per-tier)).

Serve routes with `ctx.routes.fetch(handler)`, a `(Request, PluginRequestContext) => Response`
function. The host strips the mount, so a request to `/v1/p/<id>/greeting` reaches your handler as
`/greeting`.

These members are present, shaped by your manifest: `ctx.storage`, `ctx.core`, `ctx.capabilities`,
`ctx.providers`, `ctx.schedules`, `ctx.dataSources`, `ctx.taskChecks`, `ctx.runs`, `ctx.audit`,
`ctx.extensionPoints`, `ctx.hooks`, `ctx.events.send`, `ctx.events.status`, `ctx.events.on`,
`ctx.events.worktreeStatus`, `ctx.events.notice`, `ctx.log`, and `ctx.telemetry`.

Agent tools and context sections are available only as manifest descriptors,
`contributions.agentTools` and `contributions.contextSections`. The host turns each into the same
registration compiled plugins use, binds every route to `/v1/p/<id>/`, and removes it with the package
([loaded tools](../agent-tools/loaded-tools.md#loaded-manifest-carriers)).

The registries are bound to their owner: the host stamps your plugin id on what you register, so a
schedule, data source, task check, run source, or audit verb can't be filed under another package's
name. Several are also manifest keys, and the host builds those declarations through the same seam.
Declare in the manifest when you can, because that's the copy the owner reads at install.

- **`ctx.runs`** has one call, `register({ runs })`, pointing at a GET on your namespace that answers
  `{ runs }`. Register it if your plugin owns work that starts, takes time, and ends. Core merges every
  plugin's answer into **Settings > Run history**.
- **`ctx.audit`** has `declare({ id, label })` and `record(action, entry?)`. Declare verbs in
  `contributions.auditActions` when you can. Record what a person reviewing this machine would want to
  see: work done unattended, money spent, or something leaving the Node.
- **`ctx.extensionPoints`** is the Node's many-to-many seam ([node-side extension
  points](../plugins/node-side-extension-points.md)).

`projects:read` exposes `ctx.core.projects.byWorkspace(workspaceId)` beside the project and checkout
readers. Use it to check that a task-scoped record names a project in the same workspace.

To serve a derived source, build its handler with `defineDerivedSource` from `acorn-plugin-sdk/data`
and register it with `ctx.routes.fetch(source.fetch)`. The SDK answers every source operation from
the fields you declare and calls your `query` with one handle per input
([derived sources](./derived-sources.md)).

Node actions and harnesses have no `ctx` member. The manifest is the only way in: a command whose verb
is `runNodeAction`, and `contributions.harnesses`.

### Contributing a workflow step

Handle `workflows:step-kind` from your node entrypoint. The host qualifies your entry id as
`<yourPluginId>:<entryId>`, which is the `kind` a saved workflow uses. Provide a handler and a
`describe` with a label, icon, description, field list, and output description. Add `validate` only
for checks the field rules can't express. Fields read and write the step's `with` object, and the
handler gets its template strings already rendered. Return `status: 'done'` with `structured` for a
typed result, or `status: 'failed'` with a clear error ([contributed step
kinds](../workflows/step-kinds.md#contributed-step-kinds)). The HTTP plugin is a working example.

If the handler needs another plugin, declare it in `requires.plugins` and its capability in
`permissions.node.capabilities`. Resolve the capability inside the handler, so a disabled or reloaded
provider can't leave a cached implementation. Keep the saved kind id stable, because renaming it makes
saved workflows unavailable.

### Contributing agent launch context

The terminal plugin's `terminal:launch-context` point accepts entries with a `read(taskId)` function.
Memory uses it for standing context, and an installed plugin can add startup text the same way:

```js
ctx.extensionPoints.handle('terminal:launch-context', {
  id: 'guidance',
  value: { read: async (taskId) => `Task guidance for ${taskId}` },
})
```

Terminal resolves contributors on each launch and owns the byte limits and delivery. Keep repository
instructions in `AGENTS.md` or `CLAUDE.md`, because this seam is for context the runtime owns.

### Compiled channel handlers

For a compiled channel handler, `onFrame`'s opaque connection token identifies one event viewer's
resource lifetime. Key subscriptions and interactive resources by that token, and release them in
`onDisconnect`, because one socket can carry several viewers. The token carries no credentials. Core
applies the socket's authorization before dispatch, and the channel owner validates its own payloads.

## Load a route on first use

A route registered in `init` normally imports its code at Node boot. The Node build counts that code
against its startup budget (`apps/node/scripts/check-service-budget.mjs`). Two helpers on
`@acorn/plugin-api/node` keep the registration in `init` and load the module behind it on its first
request:

- `lazyFetch(load)` wraps a handler for `ctx.routes.fetch`. `load` resolves to a
  `(Request, PluginRequestContext) => Response` function.
- `lazyRouter(load)` wraps a compiled plugin's Hono router for `ctx.routes.register`. The loaded
  router runs with the host's request context, so `ownerId(c)`, `c.env`, route parameters, mount order,
  and the app's error handler behave as they do for a router built at boot. A path the router doesn't
  serve falls through to the next handler.

```ts
ctx.routes.fetch(lazyFetch(async () =>
  (await import('../server/data/pullSourceHandler')).createPullSourceHandler()), { prefix: '/data/pulls' })
ctx.routes.register(lazyRouter(async () =>
  (await import('../server/routes/mirrorRoutes')).mirrorRoutes(store, ctx.core, emit)), { prefix: '/repos' })
```

Both helpers cache the load promise, so concurrent first requests share one load. A rejected load
clears the cache, and the next request retries it. Call each helper inside `init`, so a reload builds
a fresh handler with the reloaded plugin's handles. If the loaded module opens a connection, starts a
timer, or subscribes to anything, give that resource an owner that `dispose` closes. A cached promise
doesn't close anything.

Use one when both of these hold:

- `pnpm --filter @acorn/node measure:service-graph` shows that the module adds about 10 KB or more,
  and `--why <path fragment>` shows that nothing else on the boot path imports it.
- A normal boot doesn't need the route before the first request reaches it.

Keep these at boot:

- Work `init` or `ready` has to finish: opening stores, migrations, recovery of interrupted work, and
  schedule registration.
- Declarations that tell the Node something exists: route mounts, tool names and schemas, data source
  descriptors, context sections, hooks, and schedule keys. Their implementations can load lazily.
- A module that registers something as a side effect of being imported. Loading it lazily drops the
  registration.

Several routers that share a prefix match in registration order. Build them in one module, in that
order, and wrap the module in a single `lazyRouter`, as the GitHub plugin does in
`plugins/github/src/server/routes/mirrorRoutes.ts`. Pin the order with a test, because the Node's route
golden sees only the one lazy mount.

### Diagnose a first-use failure

A load that throws answers the request with the usual 500 error envelope. The Node logs
`unhandled error name=LazyRouteLoadError` with the request path, and the original error is the
`cause`. A handler that throws after a successful load logs its own error name. The error moves from
boot to the first request, so boot tests don't catch it. Request the route once in `pnpm dev:agent`,
or through `createApp()` in a test, as `apps/node/test/integration/routeRegistry.test.ts` does for the
GitHub mirror.
