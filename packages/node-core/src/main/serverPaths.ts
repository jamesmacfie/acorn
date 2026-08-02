import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DATABASE_FILENAME = 'acorn.sqlite'
const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

// Nearest ancestor holding pnpm-workspace.yaml.
//
// This used to walk for a package.json named "@acorn/desktop". From packages/node-core there is no
// such ancestor, so dev:node and db:locate threw and db:migrate silently created a second database
// under packages/node-core/.acorn — exit 0, plausible log line, wrong file. node-core cannot know
// where the app is; it can know where the repo is.
export function findWorkspaceRoot(startDir: string): string {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Could not locate ${WORKSPACE_MARKER} from '${startDir}'.`)
    dir = parent
  }
}

// Dev-checkout paths. Only meaningful when running from a source checkout; a packaged app passes
// its own dataDir and clientDir in through ServiceStartConfig instead.
// ponytail: the desktop app is still the owner of the dev data root and the built renderer. Both
// move to apps/node / the client bundle in the next step of the split.
export function resolveServerPaths(moduleDir: string): { clientDir: string; devDataDir: string } {
  const root = findWorkspaceRoot(moduleDir)
  return {
    clientDir: resolve(root, 'apps/desktop/dist/client'),
    devDataDir: resolve(root, 'apps/desktop/.acorn'),
  }
}

export function resolveDatabasePath(dataDir: string): string {
  return resolve(dataDir, DATABASE_FILENAME)
}
