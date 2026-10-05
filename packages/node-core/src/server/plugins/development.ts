// Development mode for a node plugin installed from a local folder (docs/plugins/dev-loop.md §
// Development mode for a folder plugin). While it's on, the node watches the folder's built files and
// reloads the plugin once they stop changing, keeps its last 500 log lines in memory, and approves
// what its derived sources read with a development grant that goes when the mode does.
//
// A folder install only, because its bytes are the author's own and aren't pinned. A downloaded
// version should always be reviewed.
import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { join } from 'node:path'
import type { PluginLogLine, PluginReloadResult } from '@acorn/protocol/api.ts'
import { broadcastPluginsChanged } from '../notify'
import { createLogger, describeError } from '../telemetry/logger'
import { pluginListStore } from './disabled'
import { declaredInputs, inputGrantsStore } from './inputGrants'
import { readLockfile } from './installer'
import { scanInstalled, type InstalledPlugin } from './loader'
import { MANIFEST_FILE } from './manifest'
import { DEVELOPMENT_FILE, keepPluginLogs, pluginLogs } from './developmentState'

const DEBOUNCE_MS = 500
// Polls up to three files by stat rather than an fs.watch, because a build that empties dist/
// kills a directory watch, and a recursive watch on Linux walks node_modules. Switch to fs.watch on
// the entry directories if polling ever shows up in a profile.
const POLL_MS = 250

const log = createLogger('plugin-development')

export type PluginDevelopmentState = {
  on: boolean
  /** The last reload that worked since development mode came on. */
  reloadedAt?: number
  /** Why the last reload failed, while the previous version keeps serving. */
  failure?: { reason: string; at: number }
}

export type PluginDevelopment = {
  /** Undefined unless the plugin was installed from a local folder. The caller checks it has a node half. */
  state(id: string): PluginDevelopmentState | undefined
  /** Turns development mode on or off. Turning it on throws for a plugin it isn't for. */
  set(id: string, on: boolean): void
  /** The kept log lines, oldest first, or null while the plugin isn't in development mode. */
  logs(id: string): PluginLogLine[] | null
  /** Every reload of a loaded plugin goes through here, so one runs at a time and a plugin in
   *  development mode records how it went. */
  reload(id: string): Promise<PluginReloadResult>
  /** Stops every watch. The list on disk stays, so the next start watches again. */
  dispose(): void
}

type Watch = {
  files: string[]
  timer?: ReturnType<typeof setTimeout>
  reloadedAt?: number
  failure?: { reason: string; at: number }
  listener: (current: Stats, previous: Stats) => void
}

export function createPluginDevelopment(options: { dataDir: string; reload(id: string): Promise<PluginReloadResult> }): PluginDevelopment {
  const { dataDir } = options
  const store = pluginListStore(dataDir, DEVELOPMENT_FILE)
  const watches = new Map<string, Watch>()

  const fromFolder = (id: string): boolean => {
    const source = readLockfile(dataDir, id)?.source
    return !!source && 'path' in source
  }
  const folderPlugin = (id: string): InstalledPlugin | undefined => fromFolder(id)
    ? scanInstalled(dataDir).installed.find((entry) => entry.manifest.id === id && entry.manifest.node) : undefined

  // Written before each reload, so the new code's first read is covered. A plugin that stops declaring
  // inputs loses its development grant, and never a grant the person gave.
  const grant = (entry: InstalledPlugin) => {
    const grants = inputGrantsStore(dataDir)
    const sources = declaredInputs(entry.manifest.contributions.dataSources)
    if (Object.keys(sources).length) {
      grants.set({ pluginId: entry.manifest.id, sources, grantedAt: Date.now(), grantedBy: 'development', development: true })
    } else if (grants.get(entry.manifest.id)?.development) grants.delete(entry.manifest.id)
  }

  // A reload of a plugin in development mode records how it went, for the strip and the roster. Any
  // other plugin's reload passes straight through.
  const attempt = async (id: string): Promise<PluginReloadResult> => {
    const watch = watches.get(id)
    if (!watch) return await options.reload(id)
    const entry = folderPlugin(id)
    if (entry) grant(entry)
    try {
      const result = await options.reload(id)
      if (result.state === 'reloaded') {
        watch.reloadedAt = Date.now()
        delete watch.failure
      } else watch.failure = { reason: result.reason ?? 'The new version failed to start.', at: Date.now() }
      return result
    } catch (error) {
      // The loader refused the new files, so the reloader never reached the host and nothing told the
      // roster. The failure rides the development state instead (../pluginHost/state.ts).
      watch.failure = { reason: describeError(error).message, at: Date.now() }
      broadcastPluginsChanged()
      throw error
    }
  }
  // One reload at a time per plugin, whether a save or the reload route asked for it, so a burst can't
  // stack worker realms or commit out of order.
  const queue = new Map<string, Promise<unknown>>()
  const reload = (id: string): Promise<PluginReloadResult> => {
    const next = (queue.get(id) ?? Promise.resolve()).catch(() => {}).then(() => attempt(id))
    queue.set(id, next)
    void next.catch(() => {}).finally(() => { if (queue.get(id) === next) queue.delete(id) })
    return next
  }

  const start = (entry: InstalledPlugin) => {
    const id = entry.manifest.id
    if (watches.has(id)) return
    const files = [MANIFEST_FILE, entry.manifest.node, entry.manifest.client]
      .filter((file): file is string => !!file).map((file) => join(entry.dir, file))
    const watch: Watch = {
      files,
      listener: (current, previous) => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
        clearTimeout(watch.timer)
        watch.timer = setTimeout(() => {
          void reload(id).then(
            (result) => { if (result.state === 'failed') log.warn(`${id}: reload failed: ${result.reason ?? ''}`) },
            (error: unknown) => log.warn(`${id}: reload failed: ${describeError(error).message}`),
          )
        }, DEBOUNCE_MS)
      },
    }
    watches.set(id, watch)
    for (const file of files) watchFile(file, { interval: POLL_MS, persistent: false }, watch.listener)
    keepPluginLogs(id, true)
    grant(entry)
  }
  const stop = (id: string) => {
    const watch = watches.get(id)
    if (watch) {
      clearTimeout(watch.timer)
      for (const file of watch.files) unwatchFile(file, watch.listener)
      watches.delete(id)
    }
    keepPluginLogs(id, false)
  }

  // Pick up where the last process left off, and forget a plugin that is gone or no longer a folder install.
  const kept = store.get().filter((id) => {
    const entry = folderPlugin(id)
    if (entry) start(entry)
    return !!entry
  })
  if (kept.length !== store.get().length) store.set(kept)

  return {
    state: (id) => {
      if (!fromFolder(id)) return undefined
      const watch = watches.get(id)
      if (!watch) return { on: false }
      return { on: true, ...(watch.reloadedAt ? { reloadedAt: watch.reloadedAt } : {}), ...(watch.failure ? { failure: watch.failure } : {}) }
    },
    set: (id, on) => {
      if (on) {
        const entry = folderPlugin(id)
        if (!entry) throw new Error('Development mode is only for node plugins installed from a local folder.')
        start(entry)
        store.set([...store.get(), id])
        return
      }
      stop(id)
      store.set(store.get().filter((name) => name !== id))
      // Back to the normal approval. A grant the person gave before development mode was replaced by
      // the development one, so they approve again.
      const grants = inputGrantsStore(dataDir)
      if (grants.get(id)?.development) grants.delete(id)
    },
    logs: (id) => (watches.has(id) ? pluginLogs(id) ?? [] : null),
    reload,
    dispose: () => { for (const id of [...watches.keys()]) stop(id) },
  }
}
