// Compare actual production owners from separate source roots with identical synthetic workloads.
// The baseline composes its installed public subscriber; the after variant acquires its new owner.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const root = resolve(args.root ?? '.'), tag = args.tag
if (!/^[a-z0-9-]+$/.test(tag ?? '')) throw new Error('Specify a distinct alphanumeric tag.')
const ownerPaths = [
  'packages/client-core/src/infra/node/fleet.ts', 'packages/client-core/src/infra/node/queryOwnership.ts',
  'packages/client-core/src/infra/node/apiClient.ts', 'packages/client-core/src/infra/persistence/queryPersistence.ts',
  'packages/client-core/src/infra/persistence/queryCacheLifecycle.ts', 'packages/client-core/src/infra/persistence/QueryCacheProvider.tsx',
  'packages/client-core/src/infra/persistence/startupRestore.ts', 'packages/client-core/src/infra/persistence/persistedState.ts',
  'packages/client-core/src/infra/persistence/devicePrefs.ts', 'packages/client-core/src/features/settings/savePref.ts',
  'apps/desktop/src/client/index.tsx', 'apps/tui/src/main.tsx', 'apps/tui/src/node/cache.ts',
]
const hashes = Object.fromEntries(ownerPaths.map((owner) => {
  try { return [owner, createHash('sha256').update(readFileSync(join(root, owner))).digest('hex')] }
  catch { return [owner, null] }
}))
const requireClient = createRequire(join(root, 'packages/client-core/package.json'))
const requirePersister = createRequire(requireClient.resolve('@tanstack/query-async-storage-persister'))
const { persistQueryClientSubscribe } = await import(requirePersister.resolve('@tanstack/query-persist-client-core'))
const { dehydrate } = await import(requireClient.resolve('@tanstack/solid-query'))
const load = (owner) => import(pathToFileURL(join(root, owner)).href)
const { clientFor, setCacheStorage, _resetFleet } = await load('packages/client-core/src/infra/node/fleet.ts')
const { shouldPersistQuery } = await load('packages/client-core/src/infra/persistence/queryPersistence.ts')
const records = new Map(), writes = []
setCacheStorage({ getItem: async (key) => records.get(key), setItem: async (key, text) => { records.set(key, text); writes.push({ key, bytes: Buffer.byteLength(text), queryCount: JSON.parse(text).clientState.queries.length }) }, removeItem: async (key) => { records.delete(key) } })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cpu = (before) => { const value = process.cpuUsage(before); return (value.user + value.system) / 1000 }
const measured = (fn) => { const before = process.cpuUsage(), start = performance.now(); const value = fn(); return { value, wallMs: performance.now() - start, cpuMs: cpu(before) } }
const data = (i) => ({ pull: { number: i, title: `Synthetic PR ${i}`, body: `body-${i}:` + 'x'.repeat(2048), headSha: `sha-${i}` }, labels: [], reviews: [], requestedReviewers: [], comments: [], commits: [], checks: [], threads: [] })
const result = { root, hashes, environment: { node: process.version, platform: process.platform, arch: process.arch }, traversal: [], memory: {} }
for (const size of [100, 1000, 3000]) {
  const cache = clientFor(`synthetic-${size}`), { client, persister } = cache
  for (let i = 0; i < size; i++) client.setQueryData(['pull', 'fixture', 'repository', String(i)], data(i))
  let scans = 0, visits = 0
  const queryCache = client.getQueryCache(), originalGetAll = queryCache.getAll.bind(queryCache)
  queryCache.getAll = () => { const rows = originalGetAll(); scans++; visits += rows.length; return rows }
  const lease = cache.persistence?.acquire()
  if (lease) await lease.restored
  const off = lease ? lease.release : persistQueryClientSubscribe({ queryClient: client, persister, dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery } })
  const beforeWrites = writes.length, beforeCpu = process.cpuUsage(), beforeWall = performance.now()
  const key = ['pull', 'fixture', 'repository', '0'], same = client.getQueryData(key)
  const updates = measured(() => { for (let i = 0; i < 30; i++) client.setQueryData(key, same) })
  const sameScans = scans, sameVisits = visits
  let resolveFetch
  const request = client.fetchQuery({ queryKey: key, staleTime: 0, queryFn: () => new Promise((resolve) => { resolveFetch = resolve }) })
  resolveFetch(same); await request
  const fetchScans = scans - sameScans
  const beforeScans = scans, beforeVisits = visits
  const invalidation = measured(() => client.invalidateQueries({ refetchType: 'none' }))
  await invalidation.value
  const immediateScans = scans - beforeScans, immediateVisits = visits - beforeVisits
  await sleep(5200)
  if (lease) await cache.persistence.flush()
  const wholeWindowCpuMs = cpu(beforeCpu), wholeWindowWallMs = performance.now() - beforeWall
  const totalScans = scans, totalVisits = visits
  queryCache.getAll = originalGetAll
  const text = records.get(`acorn-cache:acorn-1:synthetic-${size}`), stored = JSON.parse(text)
  if (stored.clientState.queries.length !== size || stored.clientState.queries.some((query) => !query.state.isInvalidated)) throw new Error('Final snapshot lost rows or invalidation state.')
  const serialize = measured(() => JSON.stringify({ buster: '', timestamp: Date.now(), clientState: dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery }) }))
  const deserialize = measured(() => JSON.parse(serialize.value))
  result.traversal.push({ size, sameDataUpdates: 30, sameDataScans: sameScans, sameDataVisits: sameVisits, sameDataWallMs: updates.wallMs, sameDataCpuMs: updates.cpuMs, fetchScans,
    invalidationTurnScansIncludingFindAll: immediateScans, invalidationTurnVisitsIncludingFindAll: immediateVisits, invalidationWallMs: invalidation.wallMs, invalidationCpuMs: invalidation.cpuMs,
    totalScansIncludingFindAll: totalScans, totalVisitsIncludingFindAll: totalVisits, wholeWindowCpuMs, wholeWindowWallMs, writes: writes.slice(beforeWrites), serializedBytes: Buffer.byteLength(text),
    serializeWallMs: serialize.wallMs, serializeCpuMs: serialize.cpuMs, deserializeWallMs: deserialize.wallMs, deserializeCpuMs: deserialize.cpuMs })
  off()
  if (lease) await cache.persistence.retire()
  client.clear()
}
global.gc?.()
const baseHeap = process.memoryUsage().heapUsed
const { client } = clientFor('synthetic-bodies')
for (let i = 0; i < 64; i++) {
  const text = Buffer.alloc(256 * 1024, 97 + i % 20).toString('utf8')
  client.setQueryData(['blob', 'fixture', 'repository', `sha-${i}`], { text })
  client.setQueryData(['files', 'fixture', 'repository', String(i), 'patch', `file-${i}`], { path: `file-${i}`, patch: text, sha: `sha-${i}` })
}
global.gc?.()
result.memory = { uniqueTextBytes: 64 * 256 * 1024, queries: client.getQueryCache().getAll().length, gcTime: client.getQueryCache().getAll()[0].gcTime, persistedQueries: dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery }).queries.length, retainedHeapBytes: process.memoryUsage().heapUsed - baseHeap }
client.clear(); global.gc?.()
result.memory.heapAfterClearBytes = process.memoryUsage().heapUsed - baseHeap
_resetFleet()
writeFileSync(new URL(`./04-cache-paired-${tag}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
process.exit(0)
