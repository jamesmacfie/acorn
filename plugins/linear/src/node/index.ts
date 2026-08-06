// The linear plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// What the composition root used to do by hand, in apps/node/src/server/providers.ts: import this
// plugin's provider descriptor, register it into the connection AND integration registries, and register
// its router into the provider route projection. Three calls in an app-layer file that named every
// provider plugin; one `ctx.providers.integration` call here.
//
// **This plugin owns NO database, and that is a decision rather than an omission.** It writes core's
// `issues` table — the generic external-item read model — which it SHARES with plugins/rollbar. Two
// plugins cannot own one table (docs/vNext/data.md § Plugin DBs), and the table is core's for four
// reasons set out in @acorn/node-core/server/integrations/itemStore.ts: the shape is provider-agnostic,
// core's `task_links` is keyed to match its primary key, core's context assembler walks that join, and
// disconnecting an integration deletes across all of it in one transaction. So this plugin reads and
// writes it through `ExternalItemStore`, a narrow core-owned seam, and has no SQLite file — which is why
// there is no `dispose`. Same outcome as docker, editor and notes, for a different reason.
//
// Not `required`: an owner who never connects Linear loses nothing by turning it off, and no core surface
// resolves anything this plugin provides. Disabling it unregisters the provider, so `/v2/p/linear/*`
// stops existing and the rail source disappears — which is the whole point of the flag.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { linearProvider } from '../server/provider'
import { linear } from '../server/routes/linear'

export const linearPlugin = (): NodePlugin => ({
  name: 'linear',
  // The router owns this provider's whole namespace, so the mount is /v2/p/linear with no prefix — the
  // segment comes from the declared provider id, never from a prefix string. It stays behind
  // `requireProviderAccess` in the projection: a task-scoped internal token may not spend the owner's
  // Linear credential.
  init: (ctx) => ctx.providers.integration(linearProvider, linear),
})
