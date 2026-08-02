import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveServerPaths } from './serverPaths'

export const ACORN_PORT = Number(process.env.ACORN_PORT) || 4317

// Dev-checkout paths, resolved on demand rather than at module load.
//
// These used to be module-level consts, which meant importing anything downstream of this file
// (core/main/server.ts, and therefore most route modules) walked the filesystem for the
// @acorn/desktop package root as a side effect of the import — and threw if it wasn't found.
// Under the vNext package split the walk starts inside node-core, where no such ancestor exists,
// so every one of those imports would fail before a single test body ran. Callers are all entry
// points that legitimately run from a checkout, so they resolve it themselves.
const devPaths = (): { clientDir: string; devDataDir: string } =>
  resolveServerPaths(dirname(fileURLToPath(import.meta.url)))

export const devClientDir = (): string => devPaths().clientDir
export const devDataDir = (): string => devPaths().devDataDir
