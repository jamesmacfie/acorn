// Where a loaded plugin's rows land when they are clicked.
//
// A row in the inbox or the bell has to say where it goes (registries/rail/attention.ts), and this
// tier names nothing: an attention descriptor carries display strings only, and a notice's `target` is
// dropped at the node because naming one means naming another plugin's handler
// (node-core server/pluginHost/context.ts). So the host picks the honest answer instead — the plugin's
// own rail source, or, for a plugin that contributes none, the Settings page that lists it. Neither is
// a guess about what the row means; both are "the thing this plugin is".
//
// Recorded here rather than derived at each call site because the two readers arrive at different
// times. The attention source asks during the registration pass that computed it; a notice arrives off
// the socket, long after, and has only a plugin id to go on.
//
// A plain Map and no Solid import, like ./surfaceFailures.ts beside it, because neither reader is
// reactive. Not cleared between passes either: a pass overwrites the plugin it re-registers, and a
// stale entry for a plugin that has gone costs nothing, since its rows and its notices went with it.
import type { NoticeTarget } from '@acorn/protocol/notices.ts'

const sources = new Map<string, string>()

/** Called once per plugin in the registration pass, with the first rail source it contributed. */
export function setPluginRowSource(pluginId: string, sourceId: string | undefined): void {
  if (sourceId) sources.set(pluginId, sourceId)
  else sources.delete(pluginId)
}

/** `source` is minted in host/chrome/chromeRegister.ts, which handles it; `settings` is the shell's,
 *  because the settings modal is (apps/desktop/src/client/activate.ts). */
export function pluginRowTarget(pluginId: string): NoticeTarget {
  const source = sources.get(pluginId)
  return source ? { kind: 'source', resourceId: source } : { kind: 'settings', resourceId: 'plugins' }
}

/** Test seam: the map is a module singleton, so cases in one file inherit each other's plugins. */
export function _resetPluginRowSources(): void {
  sources.clear()
}
