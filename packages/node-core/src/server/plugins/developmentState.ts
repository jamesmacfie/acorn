// What the rest of the node reads about development mode (./development.ts): which plugins are in it,
// and the last 500 `ctx.log` lines of each. Its own module so the plugin context and the source runtime
// can read it without importing the loader.
import type { PluginLogLine } from '@acorn/protocol/api.ts'
import { pluginListStore } from './disabled'

export const DEVELOPMENT_FILE = 'development-plugins.json'

/** Which plugins are in development mode. Read from the file per call, as input grants are, so the
 *  source runtime sees a change at once. */
export const developmentPlugins = (dataDir: string): readonly string[] => pluginListStore(dataDir, DEVELOPMENT_FILE).get()

// The log lines are in memory and per process. Nothing is written to disk, and a plugin out of
// development mode keeps no lines.

const LOG_LINES = 500
const logs = new Map<string, PluginLogLine[]>()

/** Start or stop keeping lines for one plugin. Stopping drops what was kept. */
export function keepPluginLogs(pluginId: string, keep: boolean): void {
  if (!keep) logs.delete(pluginId)
  else if (!logs.has(pluginId)) logs.set(pluginId, [])
}

/** The tap `ctx.log` writes through (../pluginHost/context.ts). Does nothing unless lines are kept. */
export function recordPluginLog(pluginId: string, level: PluginLogLine['level'], message: string): void {
  const lines = logs.get(pluginId)
  if (!lines) return
  lines.push({ at: Date.now(), level, message })
  if (lines.length > LOG_LINES) lines.shift()
}

/** The kept lines, oldest first, or null while none are kept. */
export const pluginLogs = (pluginId: string): PluginLogLine[] | null => {
  const lines = logs.get(pluginId)
  return lines ? [...lines] : null
}
