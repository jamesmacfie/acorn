// Replay: rtk proxy node --expose-gc --conditions=browser --import tsx plans/performance/06-cache-probe.mjs
// Synthetic inputs, shipped fleet clients/persisters, and the installed TanStack persistence owner.
// No normal profile or live app session is read or mutated.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { clientFor, setCacheStorage, _resetFleet } from '../../packages/client-core/src/infra/node/fleet.ts'
import { shouldPersistQuery } from '../../packages/client-core/src/infra/persistence/queryPersistence.ts'

const requireClient = createRequire(new URL('../../packages/client-core/package.json', import.meta.url))
const requirePersister = createRequire(requireClient.resolve('@tanstack/query-async-storage-persister'))
const { dehydrate, QueryObserver } = await import(requireClient.resolve('@tanstack/solid-query'))
const { persistQueryClientSubscribe } = await import(requirePersister.resolve('@tanstack/query-persist-client-core'))
const records = new Map()
const writes = []
const removes = []
setCacheStorage({
  getItem: async (key) => records.get(key),
  setItem: async (key, text) => {
    records.set(key, text)
    writes.push({ key, bytes: Buffer.byteLength(text), queryCount: JSON.parse(text).clientState.queries.length })
  },
  removeItem: async (key) => { removes.push(key); records.delete(key) },
})
const cpu = (before) => { const v = process.cpuUsage(before); return (v.user + v.system) / 1000 }
const measure = (fn) => {
  const start = performance.now(), before = process.cpuUsage()
  const value = fn()
  return { value, wallMs: performance.now() - start, cpuMs: cpu(before) }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const data = (i, bytes = 2048) => ({ pull: { number: i, title: `Synthetic PR ${i}`, body: `body-${i}:` + 'x'.repeat(bytes), headSha: `sha-${i}` }, labels: [], reviews: [], requestedReviewers: [], comments: [], commits: [], checks: [], threads: [] })
const results = { environment: { node: process.version, platform: process.platform, arch: process.arch }, traversal: [], memory: {}, durableBodies: {} }
const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.slice(6) ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use an alphanumeric result tag.')

for (const size of [100, 1000, 3000]) {
  const { client, persister } = clientFor(`synthetic-${size}`)
  for (let i = 0; i < size; i++) client.setQueryData(['pull', 'fixture', 'repository', String(i)], data(i))
  let checks = 0
  const events = {}
  const offEvents = client.getQueryCache().subscribe((event) => {
    const key = event.type === 'updated' ? `updated:${event.action.type}` : event.type
    events[key] = (events[key] ?? 0) + 1
  })
  const off = persistQueryClientSubscribe({ queryClient: client, persister, dehydrateOptions: { shouldDehydrateQuery: (query) => { checks++; return shouldPersistQuery(query) } } })
  const beforeWrites = writes.length
  const key = ['pull', 'fixture', 'repository', '0']
  const sameObject = client.getQueryData(key)
  const same = measure(() => { for (let i = 0; i < 30; i++) client.setQueryData(key, sameObject) })
  const sameChecks = checks
  let resolveFetch
  const request = client.fetchQuery({ queryKey: key, staleTime: 0, queryFn: () => new Promise((resolve) => { resolveFetch = resolve }) })
  resolveFetch(sameObject)
  await request
  const fetchChecks = checks - sameChecks
  const beforeInvalidation = checks
  const invalidation = measure(() => client.invalidateQueries({ refetchType: 'none' }))
  await invalidation.value
  const invalidationChecks = checks - beforeInvalidation
  off(); offEvents()
  await sleep(5200)
  const snap = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery })
  const serialize = measure(() => JSON.stringify({ buster: '', timestamp: Date.now(), clientState: snap }))
  const deserialize = measure(() => JSON.parse(serialize.value))
  results.traversal.push({ size, sameDataUpdates: 30, sameDataChecks: sameChecks, sameDataWallMs: same.wallMs, sameDataCpuMs: same.cpuMs, fetchChecks,
    invalidateAllChecks: invalidationChecks, invalidateAllWallMs: invalidation.wallMs, invalidateAllCpuMs: invalidation.cpuMs,
    events, writes: writes.slice(beforeWrites), serializedBytes: Buffer.byteLength(serialize.value), serializeWallMs: serialize.wallMs, serializeCpuMs: serialize.cpuMs,
    deserializeWallMs: deserialize.wallMs, deserializeCpuMs: deserialize.cpuMs })
  client.clear()
}

// Default 24 h GC applies to excluded immutable blobs and patch-bearing files too.
global.gc?.()
const baselineHeap = process.memoryUsage().heapUsed
const { client: bodyClient } = clientFor('synthetic-bodies')
for (let i = 0; i < 64; i++) {
  // Materialize unique strings so the retained-heap measurement does not count a shared rope.
  const text = Buffer.alloc(256 * 1024, 97 + i % 20).toString('utf8')
  bodyClient.setQueryData(['blob', 'fixture', 'repository', `sha-${i}`], { text })
  bodyClient.setQueryData(['files', 'fixture', 'repository', String(i), 'patch', `file-${i}`], { path: `file-${i}`, patch: text, sha: `sha-${i}` })
}
global.gc?.()
const retainedHeap = process.memoryUsage().heapUsed - baselineHeap
const excludedState = dehydrate(bodyClient, { shouldDehydrateQuery: shouldPersistQuery })
results.memory = { uniqueTextBytes: 64 * 256 * 1024, queries: bodyClient.getQueryCache().getAll().length, observers: bodyClient.getQueryCache().getAll().reduce((n, q) => n + q.getObserversCount(), 0), gcTime: bodyClient.getQueryCache().getAll()[0].gcTime, persistedQueries: excludedState.queries.length, retainedHeapBytes: retainedHeap }
bodyClient.clear(); global.gc?.()
results.memory.heapAfterClearBytes = process.memoryUsage().heapUsed - baselineHeap

// These reconstructable large-data keys are not in the files/blob exclusions.
const { client: logs } = clientFor('synthetic-logs')
logs.setQueryData(['job-log', 'fixture', 'repository', 123], { text: Buffer.alloc(2 * 1024 * 1024, 108).toString('utf8') })
logs.setQueryData(['compare', 'fixture', 'repository', 'main', 'feature'], { aheadBy: 1, files: [{ path: 'large.ts', patch: Buffer.alloc(1024 * 1024, 112).toString('utf8') }], commits: [] })
const durable = dehydrate(logs, { shouldDehydrateQuery: shouldPersistQuery })
results.durableBodies = { keys: durable.queries.map((q) => q.queryKey), persistedBytes: Buffer.byteLength(JSON.stringify(durable)) }
logs.clear()

// Fetch cancellation comes from last-observer removal only if the query function consumes signal.
const { client: cancellation } = clientFor('synthetic-cancel')
for (const consumesSignal of [false, true]) {
  let aborted = false, resolveFetch
  const observer = new QueryObserver(cancellation, { queryKey: ['probe', consumesSignal], queryFn: (context) => {
    if (consumesSignal) context.signal.addEventListener('abort', () => { aborted = true })
    return new Promise((resolve) => { resolveFetch = resolve })
  } })
  const off = observer.subscribe(() => {})
  off()
  resolveFetch('synthetic answer')
  await sleep(0)
  results[`cancellation_${consumesSignal}`] = { aborted, data: cancellation.getQueryData(['probe', consumesSignal]) ?? null }
}
cancellation.clear()
_resetFleet()
writeFileSync(new URL(`./06-cache-results-${tag}.json`, import.meta.url), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
process.exit(0)
