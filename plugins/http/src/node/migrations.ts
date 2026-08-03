// This plugin's migration chain location, resolved from THIS module so the ancestor walk starts inside
// plugins/http (see @acorn/node-core/main/pluginMigrations.ts).
import { pluginMigrationsFolder } from '@acorn/node-core/main/pluginMigrations.ts'

export const migrationsDir = (): string => pluginMigrationsFolder('http', import.meta.url)
