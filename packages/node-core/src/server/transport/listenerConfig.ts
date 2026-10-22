import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
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

// The platform's app data folder as a client sees it with neither APPDATA nor XDG_CONFIG_HOME set.
function plainAppDataDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return join(homedir(), 'AppData', 'Roaming')
  return join(homedir(), '.config')
}

function appDataDir(): string {
  if (process.platform === 'win32') return process.env.APPDATA || plainAppDataDir()
  if (process.platform !== 'darwin') return process.env.XDG_CONFIG_HOME || plainAppDataDir()
  return plainAppDataDir()
}

/** Where the CLI, the terminal client, the phone gateway, and the browser bridge keep their device tokens. */
export const configDir = (): string => process.env.ACORN_TUI_CONFIG_DIR || join(appDataDir(), 'acorn')

/** Where the installed desktop app keeps its Node's data root on this platform. */
export const desktopDataRootDir = (): string => join(appDataDir(), DESKTOP_BUNDLE_ID, 'node')

/** Every folder where a client of the Node at `dataDir` may keep device tokens, or the key that opens
 *  them, for the agents' read block (docs/managed-agents/read-block.md). Each client folder is listed
 *  as this process's environment spells it and as the platform's default, because a client started
 *  from another shell may not share the Node's `ACORN_TUI_CONFIG_DIR`, `APPDATA`, or `XDG_CONFIG_HOME`.
 *  The desktop's custody root holds its Node's root when installed, and sits beside it with a
 *  `-shell` suffix in a development build (`development_custody_root` in the desktop crate). The
 *  installed one is read from `dataDir` too, because on Linux it sits in the data folder, not here. */
export const clientCustodyDirs = (dataDir: string): string[] => {
  const root = resolve(dataDir)
  return [
    ...new Set([
      configDir(),
      ...[appDataDir(), plainAppDataDir()].flatMap((base) => [join(base, 'acorn'), join(base, DESKTOP_BUNDLE_ID)]),
      ...(basename(dirname(root)) === DESKTOP_BUNDLE_ID ? [dirname(root)] : []),
      `${root}-shell`,
    ]),
  ]
}
