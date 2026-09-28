import type { HostOwned } from './shared.js'

// ── Storage ───────────────────────────────────────────────────────────────────────────────────────

/** The host owns the filename, the migration run and the close. Call `open()` as often as you like; you
 *  get one handle per boot. */
export type PluginStorage = {
  open(): PluginDatabase
}

/** The handle `open()` returns. Opaque here because it is the host's drizzle handle, and drizzle is the
 *  one framework that crosses the loaded-tier line (docs/plugins.md § What is published). Declare
 *  `drizzle-orm` as your own dependency and narrow it: `ctx.storage.open() as MyHandle`. */
export type PluginDatabase = HostOwned<'node-core/main/pluginStorage.PluginDatabase'>

