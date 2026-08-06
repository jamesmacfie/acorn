// App-layer activation: register every plugin-owned HTTP router into the core route registry.
//
// EMPTY, and that is the Phase 2 exit condition for this file rather than an oversight. Every plugin now
// registers its own routes from `init` through `ctx.routes` (apps/node/src/server/plugins.ts is the list),
// so the app no longer names a single product route module. github was the last holdout — thirteen
// `registerRoute({ plugin: 'github', … })` calls, now in plugins/github/src/node/index.ts, where the
// mount order that Hono's matching depends on sits beside the handle those routers close over.
//
// The file is kept rather than deleted because it is still the sanctioned place for a route that belongs
// to no plugin, and because the composition roots import it for its side effect; deleting it would move
// that decision into whichever root noticed first. Provider-owned routers (linear/rollbar) register in
// apps/node/src/server/providers.ts via the integration provider registry, mounted at /v2/p/<providerId>
// through buildIntegrationProviderRoutes() in createApp() — that projection is gated by
// `requireProviderAccess`, which is why it is deliberately not folded into this file.
export {}
