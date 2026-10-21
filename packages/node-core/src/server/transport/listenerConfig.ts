import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveServerPaths } from '../storage/paths'

// An explicit listener port, or undefined for "pick one". The renderer loads from app://acorn and the
// broker learns the node endpoint from the service handshake, so two node roots can coexist safely.
//
// Read per call rather than frozen into a const at import: `dev:node` and tests set it around a dynamic
// import, and a module-level const captures whatever the first importer happened to see.
export const configuredPort = (): number | undefined => {
  const raw = process.env.ACORN_PORT
  if (!raw) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}

// Dev-checkout paths, resolved on demand rather than at module load, so importing server modules stays
// side-effect free and route and protocol tests can run without a desktop package directory or a
// filesystem walk.
export const devDataDir = (): string => resolveServerPaths(dirname(fileURLToPath(import.meta.url))).devDataDir

const DESKTOP_BUNDLE_ID = 'com.acorn.desktop'

function appDataDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

const defaultConfigDir = (): string => join(appDataDir(), 'acorn')

/** Where the CLI, the terminal client, the phone gateway, and the browser bridge keep their device tokens. */
export const configDir = (): string => process.env.ACORN_TUI_CONFIG_DIR || defaultConfigDir()

/** Where the installed desktop app keeps its Node's data root on this platform. */
export const desktopDataRootDir = (): string => join(appDataDir(), DESKTOP_BUNDLE_ID, 'node')

/** Every folder where a client of the Node at `dataDir` may keep device tokens, or the key that opens
 *  them, for the agents' read block (docs/managed-agents/read-block.md). The default client folder is
 *  listed even when `ACORN_TUI_CONFIG_DIR` moves this process's, because a client started elsewhere
 *  doesn't share the Node's environment. The desktop's custody root holds its Node's root when
 *  installed, and sits beside it with a `-shell` suffix in a development build
 *  (`development_custody_root` in the desktop crate). */
export const clientCustodyDirs = (dataDir: string): string[] => [
  ...new Set([defaultConfigDir(), configDir(), dirname(desktopDataRootDir()), `${resolve(dataDir)}-shell`]),
]
