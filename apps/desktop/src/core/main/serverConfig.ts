import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveServerPaths } from './serverPaths'

const paths = resolveServerPaths(dirname(fileURLToPath(import.meta.url)))

export const ACORN_PORT = Number(process.env.ACORN_PORT) || 4317
export const clientDir = paths.clientDir
export const devDataDir = paths.devDataDir
