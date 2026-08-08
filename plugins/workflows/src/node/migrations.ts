// This plugin's migration chain location, resolved from THIS module so the ancestor walk starts inside
// plugins/workflows (see @acorn/node-core/main/pluginMigrations.ts).
import { pluginMigrationsFolder } from '@acorn/plugin-api/node'

export const migrationsDir = (): string => pluginMigrationsFolder('workflows', import.meta.url)
