import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { devDataDir } from '@acorn/node-core/server/transport/listenerConfig.ts'

// Where `acorn` keeps its own things, and which node's data root it opens.
//
// Two directories, and they belong to different owners. The config directory is the TUI's: the fleet
// store, the device tokens, and the cache the query layer persists. The data root is the node's, and
// nothing here writes to it — `acorn` reads the lock and the identity, and the node itself owns the
// rest (docs/future/terminal/03-process-model.md § Where the TUI keeps things).

// The desktop app's own data root, when the app is installed on this machine. Its Rust shell puts the
// node's root under the bundle identifier's application-data directory, so this is the same path from
// the other side (apps/desktop/src-tauri/src/lib.rs § boot).
const DESKTOP_BUNDLE_ID = 'com.acorn.desktop'

function appDataDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

/** The TUI's config directory. `ACORN_TUI_CONFIG_DIR` overrides it, which is what the boot test uses
 *  so a test run never reads or writes the config directory of the person running it. */
export const configDir = (): string => process.env.ACORN_TUI_CONFIG_DIR || join(appDataDir(), 'acorn')

/** Which data root this machine's node uses. The node's own rule first — `ACORN_DATA_DIR`, then the
 *  dev checkout — with the desktop app's root in between, because on a laptop with the app installed
 *  the node worth opening is the one the app started.
 *
 *  Outside a checkout with no app installed, `devDataDir()` throws saying it could not find the
 *  workspace, which is the same message the node gives and the same fix: set `ACORN_DATA_DIR`. */
export function dataRootDir(): string {
  if (process.env.ACORN_DATA_DIR) return process.env.ACORN_DATA_DIR
  const desktop = join(appDataDir(), DESKTOP_BUNDLE_ID, 'node')
  if (existsSync(join(desktop, 'node.json'))) return desktop
  return devDataDir()
}
