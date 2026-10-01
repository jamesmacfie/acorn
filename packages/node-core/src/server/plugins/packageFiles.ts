// Package-owned reads, shared by Node discovery and device custody. Resolve aliases first, then
// inspect the opened descriptor: opening a FIFO with ordinary 'r' can block before a type check.
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, opendirSync, readSync, realpathSync, type Dirent, type Stats } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024
export const MAX_CLIENT_BUNDLE_BYTES = 8 * 1024 * 1024
export const MAX_PLUGIN_FILE_BYTES = 32 * 1024 * 1024
export const MAX_PLUGIN_PACKAGE_BYTES = 128 * 1024 * 1024
export const MAX_PLUGIN_PACKAGE_ENTRIES = 10_000
export const MAX_PLUGIN_PACKAGE_DEPTH = 32

export class PluginPackageFileError extends Error {
  readonly kind: 'too-large' | 'invalid'
  constructor(message: string, kind: 'too-large' | 'invalid' = 'invalid') { super(message); this.kind = kind }
}

/** Collect only a bounded directory before callers sort it for a stable package fingerprint. */
export function pluginDirectoryEntries(path: string, remainingEntries: number): Dirent[] {
  const directory = opendirSync(path)
  const entries: Dirent[] = []
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (entries.length >= remainingEntries) throw new Error('The package exceeds its entry limit.')
      entries.push(entry)
    }
  } finally { directory.closeSync() }
  return entries
}

export function visitPluginFile<T>(root: string, path: string, maxBytes: number, visit: (fd: number, stats: Stats) => T): T {
  const realRoot = realpathSync(root)
  const candidate = resolve(root, path)
  const real = realpathSync(candidate)
  const rel = relative(realRoot, real)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new PluginPackageFileError(`Package file '${path}' escapes the plugin directory.`)
  }
  // Windows lacks these flags; the canonical check and descriptor type/size checks still apply.
  const fd = openSync(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const stats = fstatSync(fd)
    if (!stats.isFile()) throw new PluginPackageFileError(`Package file '${path}' is not a regular file.`)
    if (!Number.isSafeInteger(stats.size) || stats.size > maxBytes) {
      throw new PluginPackageFileError(`Package file '${path}' exceeds the ${maxBytes} byte limit.`, 'too-large')
    }
    return visit(fd, stats)
  } finally {
    closeSync(fd)
  }
}

/** Checks actual bytes too, since a local development file can grow after fstat. */
export function streamPluginFile(fd: number, expectedBytes: number, maxBytes: number, consume: (chunk: Buffer) => void): number {
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1))
  let bytes = 0
  for (;;) {
    const size = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - bytes + 1), null)
    if (!size) break
    bytes += size
    if (bytes > maxBytes) throw new PluginPackageFileError(`Package file exceeds the ${maxBytes} byte limit while reading.`, 'too-large')
    consume(buffer.subarray(0, size))
  }
  if (bytes !== expectedBytes || fstatSync(fd).size !== expectedBytes) {
    throw new PluginPackageFileError('Package file changed size while reading. Retry after the build finishes.')
  }
  return bytes
}

export function readPluginFile(root: string, path: string, maxBytes: number): Buffer {
  return visitPluginFile(root, path, maxBytes, (fd, stats) => {
    const chunks: Buffer[] = []
    streamPluginFile(fd, stats.size, maxBytes, (chunk) => chunks.push(Buffer.from(chunk)))
    return Buffer.concat(chunks)
  })
}

export function hashPluginFile(root: string, path: string, maxBytes = MAX_PLUGIN_FILE_BYTES): string {
  return visitPluginFile(root, path, maxBytes, (fd, stats) => {
    const hash = createHash('sha256')
    streamPluginFile(fd, stats.size, maxBytes, (chunk) => hash.update(chunk))
    return hash.digest('hex')
  })
}
