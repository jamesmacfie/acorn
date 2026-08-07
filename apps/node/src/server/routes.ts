// Composition hook for route registration. Product routers register from their NodePlugin init through
// the route registry; this module remains the explicit import point used by the app composition roots.
// Core-owned routers and provider projections are mounted by createApp() under /v2/core and /v2/p.
export {}
