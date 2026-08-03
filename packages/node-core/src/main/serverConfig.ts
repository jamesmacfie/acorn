import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveServerPaths } from './serverPaths'

// An explicit listener port, or undefined for "pick one". There is no default any more: the pinned
// 4317 existed so a browser origin (and therefore IndexedDB) stayed stable, and the renderer no longer
// has a browser origin on the node — it loads from app://acorn and is told where the node bound
// (docs/vNext/architecture.md § Topology). Two nodes on one machine is now an ordinary case, and a
// pinned port makes it impossible.
//
// Read per call rather than frozen into a const at import: `dev:node` and tests set it around a
// dynamic import, and a module-level const captures whatever the first importer happened to see.
export const configuredPort = (): number | undefined => {
  const raw = process.env.ACORN_PORT
  if (!raw) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}

// Dev-checkout paths, resolved on demand rather than at module load.
//
// These used to be module-level consts, which meant importing anything downstream of this file
// (core/main/server.ts, and therefore most route modules) walked the filesystem for the
// @acorn/desktop package root as a side effect of the import — and threw if it wasn't found.
// Under the vNext package split the walk starts inside node-core, where no such ancestor exists,
// so every one of those imports would fail before a single test body ran. Callers are all entry
// points that legitimately run from a checkout, so they resolve it themselves.
export const devDataDir = (): string => resolveServerPaths(dirname(fileURLToPath(import.meta.url))).devDataDir
