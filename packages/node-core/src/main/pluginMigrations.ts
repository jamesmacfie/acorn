// Where a plugin's Drizzle chain lives at runtime, which is three different layouts.
//
//   source (tests, dev:node)   plugins/<name>/migrations/
//   built  (pnpm dev, e2e)     apps/desktop/out/migrations/<name>/   — beside core's at out/migrations/
//   packaged (.app)            <resources>/migrations/<name>/
//
// The plugin passes its own `import.meta.url` because the ancestor walk has to start from the PLUGIN's
// module, not from this one — resolving from here would find node-core's chain.
//
// THE PLUGIN-SCOPED CANDIDATE IS CHECKED FIRST AT EVERY LEVEL, and that ordering is the whole
// correctness of this function rather than a nicety. In the built layout the walk starts at
// `out/main/`, whose parent holds BOTH `out/migrations/<plugin>/` and `out/migrations/` — and the
// second is CORE's 42-migration chain. Checking the bare directory first therefore migrated every
// plugin database with core's schema: 46 core tables and none of the plugin's own. It failed silently,
// because a plugin only notices when it first touches one of its own tables — three plugin databases
// had been built that way before plugins/http, whose init queries its own rows before the listener
// binds, turned it into a boot failure. The packaged check below is the same rule; it was already
// plugin-scoped, which is why packaging was correct and the unpackaged build was not.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// resourcesPath is an Electron addition to `process`, and node-core compiles against plain Node types
// by design — read it defensively rather than widening the package's type surface.
const electronResourcesPath = (process as { resourcesPath?: string }).resourcesPath

// `meta/_journal.json` rather than the directory alone: a chain without a journal silently applies
// nothing, so an unrelated `migrations` dir must not end the search.
const isChain = (dir: string): boolean => existsSync(join(dir, 'meta/_journal.json'))

export function pluginMigrationsFolder(plugin: string, moduleUrl: string): string {
  const packaged = electronResourcesPath ? join(electronResourcesPath, 'migrations', plugin) : null
  if (packaged && isChain(packaged)) return packaged
  let dir = dirname(fileURLToPath(moduleUrl))
  for (;;) {
    // Plugin-scoped first (the built/staged layout), then the plugin package's own migrations/ (the
    // source layout). Never the other way round — see the note above.
    const scoped = join(dir, 'migrations', plugin)
    if (isChain(scoped)) return scoped
    const bare = join(dir, 'migrations')
    if (isChain(bare)) return bare
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`No migrations chain found for plugin '${plugin}' (searched ancestors of ${moduleUrl} and ${packaged ?? 'no packaged path'}).`)
    }
    dir = parent
  }
}
