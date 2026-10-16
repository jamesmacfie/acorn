import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { devDataDir } from '@acorn/node-core/server/transport/listenerConfig.ts'

const DESKTOP_BUNDLE_ID = 'com.acorn.desktop'

function appDataDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

export const configDir = (): string => process.env.ACORN_TUI_CONFIG_DIR || join(appDataDir(), 'acorn')

/** Where the installed desktop app keeps its Node's data root on this platform. */
export const desktopDataRootDir = (): string => join(appDataDir(), DESKTOP_BUNDLE_ID, 'node')

export function dataRootDir(): string {
  if (process.env.ACORN_DATA_DIR) return process.env.ACORN_DATA_DIR
  const desktop = desktopDataRootDir()
  if (existsSync(join(desktop, 'node.json'))) return desktop
  return devDataDir()
}
