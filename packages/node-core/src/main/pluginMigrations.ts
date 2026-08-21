// Resolves a built-in plugin's Drizzle migration chain across the three runtime layouts
// (docs/data-layer.md § Migrations). The module URL passed in is always the plugin's own
// (server/plugin/host.ts passes `migrationsModule: import.meta.url`), never this file's, which is what
// stops a plugin from finding node-core's own chain by proximity.
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// resourcesPath is an Electron addition to `process`. node-core compiles against plain Node types,
// so this reads it defensively rather than widening the package's type surface.
const electronResourcesPath = (process as { resourcesPath?: string }).resourcesPath

// `meta/_journal.json` rather than the directory alone: a chain without a journal silently applies
// nothing, so an unrelated `migrations` dir must not end the search.
const isChain = (dir: string): boolean => existsSync(join(dir, 'meta/_journal.json'))

export class PluginMigrationsError extends Error {
  override readonly name = 'PluginMigrationsError'
}

/** Validate an already-confined, manifest-declared migration directory. */
export function pluginMigrationsChain(plugin: string, dir: string): string {
  if (!isChain(dir)) {
    throw new PluginMigrationsError(`Plugin '${plugin}' declares migrations at '${dir}', but no Drizzle migration chain exists there.`)
  }
  return dir
}

// Source packages and loaded packages both have a `plugins/<id>/...` shape. The walk below stops here
// rather than continuing past it, so a missing chain cannot adopt dataRoot/migrations, a checkout-level
// core chain, or any other ancestor's DDL (docs/data-layer.md § Migrations).
const pluginPackageRoot = (plugin: string, start: string): string | null => {
  let dir = start
  for (;;) {
    if (basename(dir) === plugin && basename(dirname(dir)) === 'plugins') return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function pluginMigrationsFolder(plugin: string, moduleUrl: string): string {
  const packaged = electronResourcesPath ? join(electronResourcesPath, 'migrations', plugin) : null
  if (packaged && isChain(packaged)) return packaged
  let dir = dirname(fileURLToPath(moduleUrl))
  const packageRoot = pluginPackageRoot(plugin, dir)
  for (;;) {
    // Plugin-scoped first (the built/staged layout), then the plugin package's own migrations folder.
    const scoped = join(dir, 'migrations', plugin)
    if (isChain(scoped)) return scoped
    const bare = join(dir, 'migrations')
    if (isChain(bare)) return bare
    if (dir === packageRoot) {
      throw new PluginMigrationsError(`No migrations chain found for plugin '${plugin}' inside its package directory '${packageRoot}'.`)
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new PluginMigrationsError(`No migrations chain found for plugin '${plugin}' (searched ancestors of ${moduleUrl} and ${packaged ?? 'no packaged path'}).`)
    }
    dir = parent
  }
}
