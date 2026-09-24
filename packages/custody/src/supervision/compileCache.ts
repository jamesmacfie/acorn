import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Where the node service keeps V8's compiled code between launches, handed to it as
// NODE_COMPILE_CACHE. A warm cache takes 25 to 40 ms off the node's boot. Node checks each entry
// against the source it was compiled from, so a stale entry is recompiled rather than trusted, and
// an unwritable directory turns the cache off rather than failing the boot.
//
// What Node does not do is forget. It keys entries by file path, and every build renames the
// service's hashed chunks, so each update would leave the previous build's entries behind. The
// directory is keyed by the service entry's content instead, which names every chunk it loads, and
// any other build's directory is removed. At most one build's cache stays on disk.
//
// Anything that goes wrong here only costs the cache. It must never stop the node from starting.
export function compileCacheDir(root: string, serviceEntry: string): string | undefined {
  let build: string
  try {
    build = createHash('sha256').update(readFileSync(serviceEntry)).digest('hex').slice(0, 16)
  } catch {
    return undefined
  }
  try {
    for (const name of readdirSync(root)) {
      if (name !== build) rmSync(join(root, name), { recursive: true, force: true })
    }
  } catch {
    // No cache yet, which is the first launch. Node creates the directory.
  }
  return join(root, build)
}
