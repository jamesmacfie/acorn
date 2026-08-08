// This plugin's migration chain location, resolved from THIS module so the ancestor walk starts inside
// plugins/memory (see @acorn/node-core/main/pluginMigrations.ts).
import { pluginMigrationsFolder } from '@acorn/plugin-api/node'

export const migrationsDir = (): string => pluginMigrationsFolder('memory', import.meta.url)
