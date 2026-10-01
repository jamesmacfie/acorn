import { performance } from 'node:perf_hooks'
import { QueryObserver } from '../../packages/client-core/node_modules/@tanstack/solid-query/build/index.js'
import { fetchFleet } from '../../packages/client-core/src/infra/node/fanout.ts'
import { _resetFleet, refreshFleet, clientFor, setCacheStorage } from '../../packages/client-core/src/infra/node/fleet.ts'
import { readJson } from '../../packages/client-core/src/infra/node/apiClient.ts'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const nodeId = '00000000-0000-4000-8000-000000000001'
const record = { nodeId, label: 'Synthetic', endpoint: 'https://127.0.0.1:1', local: true }
let fetches = 0
let transportAborts = 0
;(globalThis as any).window = { acorn: {
  desktop: true,
  nodeFetch: async () => { fetches += 1; return { status: 200, headers: {}, body: new TextEncoder().encode('{"value":1}') } },
  nodeAbort: () => { transportAborts += 1 },
  fleetList: async () => ({ nodes: [record], statuses: [{ nodeId, state: 'online' }] }),
  onNodeStatus: () => () => {},
} }
setCacheStorage({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} })
await refreshFleet()
const cancelled = new AbortController()
cancelled.abort()
const preabortedResponse = await readJson('/v1/core/synthetic', { nodeId, signal: cancelled.signal })

const client = clientFor(nodeId).client
let queryCalls = 0
let queryAborts = 0
let complete: ((value: string) => void) | undefined
const queryFn = ({ signal }: { signal: AbortSignal }) => {
  queryCalls += 1
  signal.addEventListener('abort', () => { queryAborts += 1 }, { once: true })
  return new Promise<string>((resolve) => { complete = resolve })
}
const key = ['synthetic-shared']
const observer = new QueryObserver(client, { queryKey: key, queryFn, retry: false })
let observed: unknown
const unsubscribe = observer.subscribe((state: any) => { if (state.data !== undefined) observed = state.data })
const from = performance.now()
const partial = await fetchFleet(key, () => { throw new Error('must deduplicate existing query') }, { timeoutMs: 25 })
const afterTimeout = { elapsedMs: performance.now() - from, partial, queryCalls, queryAborts, isFetching: client.isFetching({ queryKey: key }), observers: client.getQueryCache().find({ queryKey: key })?.getObserversCount() }
complete?.('shared-result')
await delay(5)
const afterCompletion = { observed, cache: client.getQueryData(key), queryCalls, queryAborts, isFetching: client.isFetching({ queryKey: key }) }
unsubscribe()

client.clear()
_resetFleet()
delete (globalThis as any).window
console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch, commit: 'f8e4b59c', synthetic: true }, preaborted: { response: preabortedResponse, fetches, transportAborts }, sharedFanout: { afterTimeout, afterCompletion } }, null, 2))
