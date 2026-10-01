// Replay: rtk proxy node --conditions=browser --import tsx plans/performance/06-prefs-lifecycle-probe.mjs
// Shipped persistence owners with synthetic localStorage/fetch only. No app profile or network.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
const requireClient = createRequire(new URL('../../packages/client-core/package.json', import.meta.url))
const requirePersister = createRequire(requireClient.resolve('@tanstack/query-async-storage-persister'))
const { QueryObserver } = await import(requireClient.resolve('@tanstack/solid-query'))
// Match the ESM browser build imported by the TypeScript owners. Importing require's solid.cjs
// creates a second reactive runtime and cannot own their createEffect subscriptions.
const { createRoot, createSignal } = await import(requireClient.resolve('solid-js/dist/solid.js'))
const { persistQueryClientSubscribe } = await import(requirePersister.resolve('@tanstack/query-persist-client-core'))
const { clientFor, cacheKeyFor, setCacheStorage, dropNode } = await import('../../packages/client-core/src/infra/node/fleet.ts')
const { shouldPersistQuery } = await import('../../packages/client-core/src/infra/persistence/queryPersistence.ts')
const { createStartupRestore } = await import('../../packages/client-core/src/infra/persistence/startupRestore.ts')
const { setActiveNode } = await import('../../packages/client-core/src/infra/node/activeNode.ts')
const { storageKeyFor } = await import('../../packages/client-core/src/infra/persistence/persistedState.ts')
const { prefsOptions } = await import('../../packages/client-core/src/infra/queries.ts')
const { savePref } = await import('../../packages/client-core/src/features/settings/savePref.ts')
const store = new Map(Array.from({ length: 2000 }, (_, i) => [`synthetic-draft:${i}`, `draft-${i}`]))
store.set('acorn-pref:acorn-1:theme', 'light')
let keys = [...store.keys()], storageKeyReads = 0, storageValueReads = 0
globalThis.localStorage = {
  get length() { return store.size },
  key: (i) => { storageKeyReads++; return keys[i] ?? null },
  getItem: (key) => { storageValueReads++; return store.get(key) ?? null },
  setItem: (key, value) => { store.set(key, value); keys = [...store.keys()] },
}
let prefRequests = 0
const requests = []
globalThis.fetch = async (url, options) => {
  prefRequests++
  const body = JSON.parse(options.body)
  requests.push({ url, key: body.key })
  return Response.json(body)
}
setActiveNode('synthetic-prefs')
const results = { environment: { node: process.version, platform: process.platform, arch: process.arch } }
const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.slice(6) ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use an alphanumeric result tag.')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const { client } = clientFor('synthetic-prefs')
client.setQueryData(['prefs'], {})
const observers = Array.from({ length: 20 }, () => {
  const observer = new QueryObserver(client, { ...prefsOptions(false) })
  return observer.subscribe(() => {})
})
storageKeyReads = 0; storageValueReads = 0
const start = performance.now()
await savePref(client, 'theme', 'dark')
results.deviceProjection = { storageEntries: store.size, observers: observers.length, storageKeyReads, storageValueReads, wallMs: performance.now() - start, transportRequests: prefRequests }
for (const off of observers) off()

const counts = [0, 0, 0]
const states = Array.from({ length: 3 }, () => createSignal(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`scope-${i}`, { keep: 0, transient: 0 }]))))
const slices = states.map(([read], i) => ({
  id: `synthetic.slice-${i}`, key: `synthetic-pref-${i}`, scope: 'task', restore: 'panes', version: 1, unknownIds: 'retain-inert',
  codec: { parse: JSON.parse, serialize: (value) => { counts[i]++; return { keep: value.keep } } },
  empty: () => ({ keep: 0, transient: 0 }), binding: { values: read, hydrate: () => {} },
}))
const prefs = Object.fromEntries(slices.flatMap((slice) => Array.from({ length: 1000 }, (_, i) => [storageKeyFor(slice, `scope-${i}`), '{"keep":0}'])))
const nativeTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout
let writeTimers = 0, cancelledWriteTimers = 0
const writeTimerHandles = new Set()
globalThis.setTimeout = (fn, ms, ...args) => {
  const timer = nativeTimeout(fn, ms, ...args)
  if (ms === 500) { writeTimers++; writeTimerHandles.add(timer) }
  return timer
}
globalThis.clearTimeout = (timer) => { if (writeTimerHandles.has(timer)) cancelledWriteTimers++; return nativeClearTimeout(timer) }
const dispose = createRoot((dispose) => { createStartupRestore({ queryClient: client, prefs: () => prefs, ready: () => true, slices: () => slices }); return dispose })
await sleep(0)
counts.fill(0); writeTimers = 0
const beforeRequests = prefRequests
states[0][1]((old) => ({ ...old, 'scope-0': { keep: 0, transient: 1 } }))
await sleep(0)
results.transientSliceChange = { serializationCounts: [...counts], timersCreated: writeTimers }
counts.fill(0); writeTimers = 0
for (let i = 0; i < 10; i++) {
  states[0][1]((old) => ({ ...old, 'scope-0': { keep: 1, transient: i } }))
  await sleep(0)
}
results.sameQueuedValue = { changes: 10, serializationCounts: [...counts], timersCreated: writeTimers, timersCancelled: cancelledWriteTimers }
await sleep(600)
results.sameQueuedValue.transportRequests = prefRequests - beforeRequests
dispose()
globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClearTimeout
client.clear()

// A provider has unsubscribed on Node switch but its persister still has a trailing snapshot.
const snapshots = new Map(), storageWrites = [], storageRemovals = []
setCacheStorage({ getItem: async (key) => snapshots.get(key), setItem: async (key, value) => { snapshots.set(key, value); storageWrites.push({ key, queries: JSON.parse(value).clientState.queries.length }) }, removeItem: async (key) => { storageRemovals.push(key); snapshots.delete(key) } })
const nodeId = 'synthetic-removed', { client: removedClient, persister } = clientFor(nodeId)
removedClient.setQueryData(['tasks'], [{ id: 'synthetic-task', title: 'Synthetic retained snapshot' }])
const offPersistence = persistQueryClientSubscribe({ queryClient: removedClient, persister, dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery } })
removedClient.setQueryData(['tasks'], [{ id: 'synthetic-task', title: 'first write' }])
await sleep(20)
removedClient.setQueryData(['tasks'], [{ id: 'synthetic-task', title: 'trailing write' }])
offPersistence()
// IndexedDB is absent in this synthetic Node host, as in the terminal client. The direct del call
// throws synchronously before its attached Promise catch. Keep the error type and continue the probe.
let removalError = null
try { dropNode(nodeId) } catch (error) { removalError = error.name }
await sleep(20)
const afterDrop = { inMemoryQueries: removedClient.getQueryCache().getAll().length, storageRemoveCalls: storageRemovals.length, snapshotPresent: snapshots.has(cacheKeyFor(nodeId)), removalError }
await sleep(5200)
results.removedNode = { afterDrop, afterThrottle: { snapshotPresent: snapshots.has(cacheKeyFor(nodeId)), retainedQueries: JSON.parse(snapshots.get(cacheKeyFor(nodeId))).clientState.queries.length, storageWrites, storageRemoveCalls: storageRemovals.length } }
removedClient.clear()
delete globalThis.localStorage
writeFileSync(new URL(`./06-prefs-lifecycle-results-${tag}.json`, import.meta.url), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
process.exit(0)
