import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// The current core database. The dedicated filename lets openDataRoot reject a source database rather
// than quietly opening a second database beside it.
const DATABASE_FILENAME = 'core.sqlite'
const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

export function findWorkspaceRoot(startDir: string): string {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Could not locate ${WORKSPACE_MARKER} from '${startDir}'.`)
    dir = parent
  }
}

export function resolveServerPaths(moduleDir: string): { devDataDir: string } {
  return { devDataDir: resolve(findWorkspaceRoot(moduleDir), 'apps/node/.acorn') }
}

export function resolveDatabasePath(dataDir: string): string {
  return resolve(dataDir, DATABASE_FILENAME)
}
