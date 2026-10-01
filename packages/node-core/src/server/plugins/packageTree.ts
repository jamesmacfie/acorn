import { opendirSync, realpathSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { MAX_PLUGIN_FILE_BYTES, MAX_PLUGIN_PACKAGE_BYTES, MAX_PLUGIN_PACKAGE_DEPTH, MAX_PLUGIN_PACKAGE_ENTRIES } from './packageFiles'

export const PLUGIN_TREE_LIMITS = { depth: MAX_PLUGIN_PACKAGE_DEPTH, entries: MAX_PLUGIN_PACKAGE_ENTRIES, fileBytes: MAX_PLUGIN_FILE_BYTES, bytes: MAX_PLUGIN_PACKAGE_BYTES }

/** Does not descend through aliases. Real directories are bounded before recursion, and every
 * alias must resolve to an existing ordinary file/directory inside the package. */
export function assertPluginPackageTree(root: string, limits = PLUGIN_TREE_LIMITS): void {
  const realRoot = realpathSync(root)
  let entries = 0
  let bytes = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > limits.depth) throw new Error('The package has too many directory levels.')
    const directory = opendirSync(dir)
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++entries > limits.entries) throw new Error('The package has too many entries.')
        const full = join(dir, entry.name)
        const name = relative(root, full)
        if (entry.isSymbolicLink()) {
          let real: string
          try { real = realpathSync(full) } catch { throw new Error(`The package contains a broken symlink (${name}).`) }
          if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error(`The package contains a symlink pointing outside itself (${name}).`)
          const stats = statSync(real)
          if (!stats.isFile() && !stats.isDirectory()) throw new Error(`The package contains an unsupported link target (${name}).`)
        } else if (entry.isDirectory()) {
          walk(full, depth + 1)
        } else if (entry.isFile()) {
          const stats = statSync(full)
          bytes += stats.size
          if (stats.size > limits.fileBytes || bytes > limits.bytes) throw new Error('The package exceeds its file byte limits.')
        } else {
          throw new Error(`The package contains an unsupported entry (${name}).`)
        }
      }
    } finally { directory.closeSync() }
  }
  walk(root, 0)
}
