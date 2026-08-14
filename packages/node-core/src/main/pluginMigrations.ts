// Where a BUILT-IN plugin's Drizzle chain lives at runtime, which is three different layouts.
//
//   source (tests, dev:node)   plugins/<name>/migrations/
//   built  (pnpm dev, e2e)     apps/desktop/out/migrations/<name>/   — beside core's at out/migrations/
//   packaged (.app)            <resources>/migrations/<name>/
//
// The walk starts from the PLUGIN's own module, not from this one — resolving from here would find
// node-core's chain at packages/node-core/migrations. A built-in declares that module as
// `migrationsModule: import.meta.url` on its NodePlugin and the host passes it in (server/plugin/host.ts);
// nothing here is reachable from a plugin, which is what stops a plugin choosing a chain by proximity.
// A loaded plugin never needs an ancestor search at all: its manifest names the directory, confined to
// its package, and pluginMigrationsChain below only validates it.
//
// The plugin-scoped candidate is checked first at every level. Built and packaged layouts place core
// and plugin chains beside one another, so selecting a bare migrations directory could apply the wrong
// schema. The same ordering is used for source, staged, and packaged runtimes.
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// resourcesPath is an Electron addition to `process`, and node-core compiles against plain Node types
// by design — read it defensively rather than widening the package's type surface.
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

// Source packages and loaded packages both have a `plugins/<id>/...` shape. When the start URL has
// that shape, never walk above the package root: a missing chain must not adopt dataRoot/migrations,
// a checkout-level core chain, or any other ancestor's DDL.
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
