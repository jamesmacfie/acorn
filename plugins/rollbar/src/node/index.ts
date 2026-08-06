// The rollbar plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// Replaces three calls in apps/node/src/server/providers.ts — connection registry, integration registry,
// provider route projection — with one, and moves the declaration into the package that implements it.
//
// **No database, deliberately.** rollbar writes core's `issues` and `issue_resources` (an item's
// occurrence list and each occurrence's detail are provider-owned children with their own freshness), and
// it SHARES `issues` with plugins/linear. Two plugins cannot own one table, so both reach it through
// `ExternalItemStore` — see @acorn/node-core/server/integrations/itemStore.ts for why those tables stayed
// core's rather than being copied per provider. No SQLite file means no `dispose`.
//
// Its collection-level freshness markers live in CORE's `sync_state` under the
// `provider:rollbar:<connection>:…` key space, reached through the same store. That is now a genuinely
// different table from the `sync_state` github owns; the two key spaces used to share one row space with
// only convention keeping them apart.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { rollbarProvider } from '../server/provider'
import { rollbar } from '../server/routes/rollbar'

export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => ctx.providers.integration(rollbarProvider, rollbar),
})
