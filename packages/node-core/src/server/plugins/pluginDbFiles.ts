// Host preparation and the worker's native SQLite open share this preflight. Native SQLite does
// not use Node's filesystem permission checks, so its exact state files must be regular files.
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync } from 'node:fs'

export const pluginDbFiles = (databasePath: string): readonly string[] =>
  [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]

function checkFile(path: string, create: boolean, privateMode: boolean): void {
  // Also check the directory entry on hosts without POSIX NOFOLLOW. This rejects static links
  // there, while the descriptor flags below close that leaf-open gap on POSIX hosts.
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (entry && !entry.isFile()) throw new Error('Plugin database state must be a regular file.')
  let fd: number
  try {
    // NONBLOCK keeps a FIFO from hanging preflight. NOFOLLOW refuses a linked leaf before it can
    // be opened or chmodded; fstat and fchmod operate on the same descriptor.
    fd = openSync(path, (privateMode ? constants.O_RDWR : constants.O_RDONLY)
      | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0) | (create ? constants.O_CREAT : 0), 0o600)
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Plugin database state must be a regular file.')
    if (privateMode) fchmodSync(fd, 0o600)
  } finally {
    closeSync(fd)
  }
}

/** Missing files are normal before SQLite creates a database or opens its WAL. */
export function validatePluginDbFiles(databasePath: string): void {
  for (const path of pluginDbFiles(databasePath)) checkFile(path, false, false)
}

export function securePluginDbFiles(databasePath: string, create: boolean): readonly string[] {
  const paths = pluginDbFiles(databasePath)
  for (const path of paths) checkFile(path, create, true)
  return paths
}
