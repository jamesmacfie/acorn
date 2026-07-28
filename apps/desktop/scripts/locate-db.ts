// Print the development database used by this checkout. Resolving from this module's location,
// rather than process.cwd(), keeps the result correct when pnpm runs the command from a worktree.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDatabasePath, resolveServerPaths } from '../src/core/main/serverPaths.ts'

const here = dirname(fileURLToPath(import.meta.url))
const { devDataDir } = resolveServerPaths(here)

process.stdout.write(`${resolveDatabasePath(devDataDir)}\n`)
