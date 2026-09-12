import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CacheStorage } from '@acorn/client-core/infra/node/fleet.ts'
import { configDir } from './paths'

// The query cache, on files. client-core persists one partition per node so a restart renders from
// last-known data (docs/caching.md § Renderer query cache); it does that through IndexedDB, and a
// terminal has none.
//
// One file per node, named by the partition key, in the TUI's own config directory.
//
// Reads are synchronous and writes are not, which is the shape of when each happens. The one read is
// `persistQueryClient`'s restore in `main.tsx`, before the renderer exists, where synchronous is
// simply the shorter spelling. A write lands whenever a query settles, which is while the renderer
// owns the terminal, and a few hundred kilobytes written synchronously there is a dropped frame.

export function fileCacheStorage(dir: string = join(configDir(), 'cache')): CacheStorage {
  // Slashes and colons appear in nothing client-core generates — the key is `acorn-cache:<uuid>` —
  // but the value comes from a node id, so it is encoded rather than trusted into a path.
  const pathFor = (key: string): string => join(dir, `${encodeURIComponent(key)}.json`)
  return {
    // A missing or unreadable file is a cold start, which is a state every consumer already handles.
    getItem: async (key) => {
      try {
        return readFileSync(pathFor(key), 'utf8')
      } catch {
        return undefined
      }
    },
    // Written beside the target and renamed over it, so a reader never sees a half-written snapshot
    // and a crash mid-write leaves the previous one readable. `rename` within a directory is atomic
    // on every filesystem this runs on. The persister throttles to one call every five seconds, so
    // the temp name needs no per-write suffix: a second write for the same key cannot overlap.
    setItem: async (key, value) => {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const target = pathFor(key)
      const temp = `${target}.tmp`
      await writeFile(temp, value, { mode: 0o600 })
      await rename(temp, target)
    },
    removeItem: async (key) => {
      await rm(pathFor(key), { force: true })
    },
  }
}
