# Package shape

This page describes the folder layout every plugin package in this repository follows. Read it when
you add a plugin or move a file inside one. It's part of the [plugin reference](../plugins.md).

## Package shape

Every plugin, in either tier, has the same shape and declares only the parts it has:

```text
plugins/<name>/
  acorn-plugin.config.mjs   loaded tier only; the build script generates the manifest from it
  migrations/               the Drizzle chain, paired with src/node/schema.ts
  src/
    node/       index.ts, the NodePlugin factory, and schema.ts. Nothing else.
    server/     routes/*.ts Hono routers, engines, stores, drivers, the vendor client
    client/     index.ts, components, <plugin>Client.ts, *Store.ts, contributions
    tree/       loaded tier only: the remote component tree the host draws
    contract/   only what another package imports. No tests.
    shared/     wire types, api.ts route builders, anything both halves read
    testkit/    index.ts for node-side tests elsewhere, client.ts for client-side
  tsconfig.json     { "extends": "../tsconfig.base.json", "include": ["src"] }
  vitest.config.ts  export { default } from '../vitest.shared'
  drizzle.config.ts export { default } from '../drizzle.shared'   (table-owning plugins only)
```

The exports map has five kinds, and a plugin declares the ones it has:

- `./node/index.ts` for the Node activation entrypoint.
- `./client/index.ts` for the client activation entrypoint.
- `./contract/*` for the cross-plugin contract.
- `./testkit` for node-side test helpers.
- `./testkit/client` for client-side test helpers.

A plugin with none of them declares an empty map. `agent-cost` is the case: it draws a remote tree
from a relative entry in its plugin config, so nothing outside the package resolves a subpath.

## Contract and shared

`contract/` holds only what another package imports. `shared/` holds what both halves of this plugin
read. The architecture test enforces the first half, and a test file never belongs under
`contract/`. If you aren't sure which folder a module goes in, ask whether anything outside this
package imports it. If nothing does, it goes in `shared/`. The rest of the naming rules are in
[conventions](../conventions.md).

## Shared config files

The three config files are one line each. Their content lives in `plugins/tsconfig.base.json`,
`plugins/vitest.shared.ts`, and `plugins/drizzle.shared.ts`, and all three are in `turbo.json`'s
`globalDependencies`, so editing one invalidates every plugin's cached lint and test.

`include` stays in each plugin's `tsconfig.json`, because TypeScript resolves a relative path
against the file that declares it. `package.json` can't be hoisted, because npm has no `extends`, so
its `exports` and `scripts` blocks are copied.

## Keep node and server free of the shell

`apps/node` imports every compiled plugin's `node/index.ts`, and an entrypoint evaluates every module
behind it. One module that reaches for something only the desktop bundle has breaks the standalone
Node at link time, before any of it runs. The composition-root suites under
`apps/node/test/integration/` boot that graph, so the commit that breaks it fails there. The folder
picker is a Tauri command, and the preview pane is a child webview the shell drives
([host-owned webviews](../shell/webviews.md)).

## Plugins without every folder

Not every plugin has every directory:

- `plugins/agents` registers the built-in Claude, Codex, and Aider profiles. There are no separate
  profile packages.
- Onboarding is a client overlay with core setup support. Its client entry is a plain `index.ts`,
  because a module that only registers a lazy component builds it with `createComponent`.
- The loaded Linear and Rollbar packages are integration providers that use core's generic
  external-item store instead of a plugin database.
- A loaded plugin's UI lives in `tree/`, not `client/`, because it's a bundle for a sandbox and not a
  `ClientPlugin`.
