// Where a plugin's Drizzle chain lives at runtime, which is two different places.
//
// In dev and test the migrations sit next to the plugin's source (plugins/<name>/migrations). In a
// packaged app there is no plugins/ tree at all — the build stages every chain under
// <resources>/migrations/<plugin> (apps/desktop/electron.vite.config.ts), because the service is one
// bundled file by then. Same problem core's own migrationsFolder solves, same shape of answer:
// prefer the packaged location, else walk ancestors from the calling module.
//
// The plugin passes its own `import.meta.url` because the ancestor walk has to start from the
// PLUGIN's module, not from this one — resolving from here would find node-core's chain.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// resourcesPath is an Electron addition to `process`, and node-core compiles against plain Node types
// by design — read it defensively rather than widening the package's type surface.
const electronResourcesPath = (process as { resourcesPath?: string }).resourcesPath

export function pluginMigrationsFolder(plugin: string, moduleUrl: string): string {
  const packaged = electronResourcesPath ? join(electronResourcesPath, 'migrations', plugin) : null
  if (packaged && existsSync(packaged)) return packaged
  let dir = dirname(fileURLToPath(moduleUrl))
  for (;;) {
    const candidate = join(dir, 'migrations')
    // `meta/_journal.json` rather than the directory alone: walking up from a plugin's src/node can
    // otherwise stop at an unrelated `migrations` dir, and a chain without a journal silently applies
    // nothing.
    if (existsSync(join(candidate, 'meta/_journal.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`No migrations chain found for plugin '${plugin}' (searched ancestors of ${moduleUrl} and ${packaged ?? 'no packaged path'}).`)
    }
    dir = parent
  }
}
