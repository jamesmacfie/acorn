# Provider boundaries

This page covers how provider credentials stay on the Node, how provider failures reach the client,
and how to recognize a provider error that crossed the plugin worker boundary.

## Provider boundaries

Provider credentials are read through named plugin accessors and `CoreServices`. The owning provider
plugin makes its own outbound calls, and there's no shared host allowlist or central outbound guard.
Each provider maps responses into protocol-safe projections, so raw payloads and credentials don't
reach the renderer.

Every outbound provider call, for a connection test, a mirrored resource, a project list, or a route's
own fetch, runs inside the `secrets.use` callback, not after it returns the plaintext. A provider that
echoes its credential in an error body has it scrubbed there, before the failure is logged or sent
(`packages/node-core/src/server/core/secrets.ts`).

## Errors

A provider failure that isn't a deliberate `ProviderOperationError` is flattened to
`provider_unavailable` before it reaches the client
(`packages/node-core/src/server/integrations/respondProvider.ts`). Core's connection routes and plugin
connect flows, such as GitHub's device flow, share it, because an upstream message can quote a URL, a
token fragment, or a response body. The error's name and a scrubbed message go to the log with the
request ID the client was shown.

Ask `isProviderOperationError(error)`, not `error instanceof ProviderOperationError`. Two things break
class identity:

- A plugin bundle inlines its whole dependency graph, that class included, because a loaded plugin's
  folder has no `node_modules` (`apps/node/scripts/build-plugin.mjs`).
- A plugin runs in an isolated worker, so what it throws is torn down by `errorToWire` and rebuilt as
  a plain `Error` (`packages/node-core/src/server/plugins/pluginRpc.ts`).

So `instanceof` is false both ways, and a typed failure such as `provider_needs_auth` would land in
the catch-all. The shape survives, and the guard checks it: an `Error` with a numeric `status` and a
`code` from `PROVIDER_ERROR_CODES`. Both fields must be on the RPC record, which is why `errorToWire`
names `status` beside `code`. Any other class that crosses this boundary, Hono's included, needs the
same care.
