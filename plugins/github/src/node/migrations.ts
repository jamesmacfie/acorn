// This plugin's migration chain location, resolved from THIS module so the ancestor walk starts inside
// plugins/github (see @acorn/node-core/main/pluginMigrations.ts).
import { pluginMigrationsFolder } from '@acorn/node-core/main/pluginMigrations.ts'

export const migrationsDir = (): string => pluginMigrationsFolder('github', import.meta.url)
