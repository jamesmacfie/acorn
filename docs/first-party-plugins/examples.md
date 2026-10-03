# Plugins to copy

This page lists the plugins in `plugins/` that use only what a third-party plugin has, in the order an
outside author should read them. It's part of [first-party plugins](../first-party-plugins.md).

## Plugins that follow the third-party rules

Build any of these into a data root with `pnpm --filter @acorn/node build:plugin <id>`.

**agent-cost** is the client-only loaded example. It has no node bundle and asks for no permissions.
Its remote tree fills `agents:session-header`, receives the owner's usage data and configured model
prices, and keeps calculation, fallback, and display inside its own package. Read it when a feature
belongs inside another plugin's UI but should stay independently installable. Its README records the
boundary that lets the folder move to another repository.

**model-providers** is the smallest node-only loaded plugin. It registers connection providers and
model adapters through `ctx.providers`, with no client half, tables, capabilities, or `secrets` grant,
because core resolves the stored credential and hands the adapter a key. Its manifest has two egress
hosts and an empty `contributions`. Start here to see how small a plugin can be.

**nodes-file** contributes Nodes instead of data. It has one registration through
`ctx.providers.nodes`, no core, secret, process, or network grants, one read-write file grant resolved
from `ACORN_NODES_FILE`, and no routes, tables, or client half. It does nothing when that variable is
unset, and it isn't bundled. Read it for the rule that a first-party control-plane plugin gets no host
privilege a third party lacks ([Node providers](../plugins/node-providers.md)).

**rollbar** is the reference integration. Its node half uses the fetch carrier, and its client half is a
sandboxed bundle, not a `ClientPlugin`. Its provider registration is:

```ts
export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => ctx.providers.integration(rollbarProvider, createRollbarFetch(ctx.core.projects)),
})
```

Codecs, sync policy, routes, and the tree and descriptor projection all live in the plugin. Copy this
shape for an external item source. It creates a task from an item and links them through the host-owned
promotion flow, and it has no `tasks` facet, no task write scope, and no `secrets` grant.

**http** is the fullest self-contained feature plugin: its own SQLite file and migration chain staged
inside its package, three surfaces in one bundle, a descriptor rail source, use-scoped secrets, and an
`agentContexts` entry served by two of its own routes. Read it for the storage seam.
`apps/node/test/integration/plugins/httpLoaded.test.ts` covers a migration arriving through an
installer update against a populated database.

**linear** is the second integration. It differs from rollbar in two places worth studying. Promotion is
looser, because a Linear issue carries its own branch name. And it contributes a reference panel that a
pull request opens without importing linear, through `openRefPanel({ providerId, displayId })`. The one
GitHub-to-Linear coupling left is `linkifyLinearIds`, which scans pull-request body HTML for Linear's
key prefixes. The workspace project picker didn't cross, because choosing which Linear projects a
workspace follows writes core's workspace state, which the bridge and `CoreServices` don't expose.

**database** runs over the host-owned document surface: the host draws the SQL editor, and the plugin's
tree draws the button bar, sidebar, and result grid below it ([the database pane](../database/pane.md)).
It publishes one capability, `database.query`, in its own namespace.

Also worth reading: **changes**, for what happens when the one contribution keeping a plugin
first-party stops needing to. Its tool card was a private registry only a compiled plugin could reach.
Opening `agents:tool-card` turned it into a manifest line, and the plugin stayed compiled by
preference.
