# Testing a plugin

This page covers how a plugin's tests reach the host: the two test environments, the testkit, and
asserting on telemetry. It's part of [plugin authoring](../plugin-authoring.md).

## Testing

`plugins/vitest.shared.ts` gives every repository plugin two Vitest projects:

- `logic` runs `src/**/*.test.ts` in a Node environment.
- `hosts` runs `src/**/*.test.tsx` under jsdom with `vite-plugin-solid`, for tests that render a
  region.

A `.ts` test loads every module behind what it imports, and Solid compiles a component to code that
touches `window` at module scope. One component on the import path makes a module unloadable in the
`logic` project. So keep logic you want to test in a `.ts` module of its own, away from components, and
import client contracts from `@acorn/plugin-api/client`, which holds no `.tsx`.

## The testkit

Test code crosses the same seam as production code, through `@acorn/plugin-api/testkit`. Don't forge a
plugin context with a cast. A forged context can't fail when the host's context changes, so the test
stays green against a shape that no longer exists.

`makeTestNodeContext({ plugin, permissions?, migrations?, userId? })` isn't a mock. It calls the same
`server/pluginHost/context.ts` the host calls at boot, over a temporary data root, so which tier a test
gets is the host's decision. Its `cleanup()` runs the host's registration rollback. `userId` binds the
machine identity, because a context with nothing seeded has no owner and
`ctx.core.identity.active()` answers null. Pass it where the plugin reads the owner from `ctx`, such
as an agent tool, a workflow step, or a telemetry sink.

`makeTestRequestContext` does the same for a loaded plugin's fetch handler: the real
`PluginRequestContext`, with canned answers for provider calls a test can't make. The testkit also has
`makeTestDb`, `makeTestPluginDb`, `testEnv`, `testGate`, `seedProviderConnection`, core's `schema` for
seeding fixtures, and `validatePluginConfig`, which runs the real manifest schema over an
`acorn-plugin.config.mjs`. `apps/node/test/integration/pluginSystem/pluginConfigs.test.ts` checks every
loadable plugin's config that way.

The testkit is safe in a Node environment by rule: no components and no `window`. A first-party test
that still reaches node-core or client-core directly is part of a shrinking baseline in the boundaries
suite. A new deep import means the testkit is missing something, and the fix goes in the testkit.

`@acorn/plugin-api/testkit/client` is the client half, including the two extension registries a
plugin's jsdom test reaches.

## In tests

`makeTestNodeContext` records what your plugin emitted, so a test asserts on telemetry with no sink of
its own:

```ts
const ctx = makeTestNodeContext({ plugin: { name: 'github' } })
ctx.telemetry.startSpan('reindex').end('error')
expect(ctx.recorded.filter((record) => record.kind === 'span')).toMatchObject([{ name: 'reindex', status: 'error' }])
ctx.cleanup()
```

`ctx.recorded` is every record the Node built since the context was made, newest last, flushed on read
so an assertion sees what the line above it did. A span appears once it has ended, with its end
attributes merged into its start attributes. `attrs.owner` says whose a record is, because the
recorder is an ordinary sink and sees the host's records about your plugin too. `cleanup()` drops it
with your other registrations.

A hand-written package can't import the testkit. Check its manifest by running it through a Node, and
check its node half against `acorn-plugin-types` with `tsc` ([start from the
scaffold](./start-from-the-scaffold.md)).
