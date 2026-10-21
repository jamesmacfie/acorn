import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { desktopDataRootDir, devDataDir } from '@acorn/node-core/server/transport/listenerConfig.ts'

export { configDir, desktopDataRootDir } from '@acorn/node-core/server/transport/listenerConfig.ts'

export function dataRootDir(): string {
  if (process.env.ACORN_DATA_DIR) return process.env.ACORN_DATA_DIR
  const desktop = desktopDataRootDir()
  if (existsSync(join(desktop, 'node.json'))) return desktop
  return devDataDir()
}
