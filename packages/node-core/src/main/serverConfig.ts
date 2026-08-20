import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveServerPaths } from './serverPaths'

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
