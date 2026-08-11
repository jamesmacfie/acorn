// This plugin's migration chain location, resolved from THIS module so the ancestor walk starts inside
// plugins/http (see @acorn/node-core/main/pluginMigrations.ts).
//
// A TEST seam now, and only that. http ships loaded, so at runtime the chain is the one staged inside the
// installed package and named by the manifest, and the host resolves it — `init` opens `ctx.storage`
// instead of calling this. The suites that drive the routes against a real SQLite file still need a path
// to migrate from, and the source tree's `plugins/http/migrations` is the copy they have.
import { pluginMigrationsFolder } from '@acorn/plugin-api/node'

export const migrationsDir = (): string => pluginMigrationsFolder('http', import.meta.url)
