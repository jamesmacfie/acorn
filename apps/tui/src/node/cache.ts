import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CacheStorage } from '@acorn/client-core/infra/node/fleet.ts'
import { configDir } from './paths'

// The query cache, on files. client-core persists one partition per node so a restart renders from
// last-known data (docs/caching.md § Renderer query cache); it does that through IndexedDB, and a
// terminal has none.
//
// One file per node, named by the partition key, in the TUI's own config directory. Synchronous
// because the calls are throttled to one every five seconds and the payload is a few hundred
// kilobytes: a worker to move that off the loop would be more machinery than the write costs.

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
    setItem: async (key, value) => {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(pathFor(key), value, { mode: 0o600 })
    },
    removeItem: async (key) => rmSync(pathFor(key), { force: true }),
  }
}
