import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// vNext's core database. Deliberately NOT V1's acorn.sqlite: the rename is what makes "vNext never
// migrates V1 databases" (docs/vNext/plan.md) enforceable — openDataRoot refuses a directory holding
// the old filename rather than quietly opening a second database beside it.
const DATABASE_FILENAME = 'core.sqlite'
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

// The dev-checkout data root. Only meaningful when running from a source checkout; a packaged app
// passes its own dataDir in through ServiceStartConfig instead.
//
// It belongs to apps/node — the service owns SQLite, blobs and the node identity, and `dev:node` must
// be able to run without apps/desktop existing at all. This used to return a `clientDir` under
// apps/desktop too, because the node served the built renderer; that left with the app:// origin move
// (main/appScheme.ts owns the renderer's bytes now, and the node serves no web assets).
export function resolveServerPaths(moduleDir: string): { devDataDir: string } {
  return { devDataDir: resolve(findWorkspaceRoot(moduleDir), 'apps/node/.acorn') }
}

export function resolveDatabasePath(dataDir: string): string {
  return resolve(dataDir, DATABASE_FILENAME)
}
