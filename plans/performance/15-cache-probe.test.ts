import { expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileCacheStorage } from '../../apps/tui/src/node/cache'
import { cacheKeyFor, clientFor, dropNode, setCacheStorage, _resetFleet } from '../../packages/client-core/src/infra/node/fleet'

it('records whether forgetting a Node removes the installed terminal file partition', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Unsafe output tag')
  const path = join(dirname(fileURLToPath(import.meta.url)), `15-cache-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists')
  const dir = mkdtempSync(join(tmpdir(), 'acorn-tui-cache-probe-')), node = 'synthetic-forgotten-node'
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const store = fileCacheStorage(dir); setCacheStorage(store)
    await store.setItem(cacheKeyFor(node), '{"synthetic":"persisted before forgetting"}')
    clientFor(node).client.setQueryData(['synthetic'], 'private-free synthetic record')
    let thrown: string | null = null
    try { dropNode(node) } catch (error) { thrown = error instanceof Error ? error.message : String(error) }
    await new Promise(resolve => setTimeout(resolve, 20))
    writeFileSync(path, JSON.stringify({ fixture: 'Actual dropNode with real TUI fileCacheStorage in /tmp; no browser IndexedDB',
      fileRemains: (await store.getItem(cacheKeyFor(node))) !== undefined,
      freshClientQueries: clientFor(node).client.getQueryCache().getAll().length,
      browserIndexedDBPresent: typeof indexedDB !== 'undefined', warningCount: warnings.mock.calls.length, synchronousError: thrown }, null, 2) + '\n')
    expect(clientFor(node).client.getQueryCache().getAll()).toHaveLength(0)
  } finally { warnings.mockRestore(); _resetFleet(); rmSync(dir, { recursive: true, force: true }) }
})
