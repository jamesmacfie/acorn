// Fail-before correctness cases against root-selected production owners. Synthetic platform only.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const root = resolve(args.root ?? '.'), tag = args.tag
if (!/^[a-z0-9-]+$/.test(tag ?? '')) throw new Error('Specify a distinct tag.')
const load = (path) => import(pathToFileURL(join(root, path)).href)
const requireClient = createRequire(join(root, 'packages/client-core/package.json'))
const { createRoot, createSignal } = await import(requireClient.resolve('solid-js/dist/solid.js'))
const records = new Map(), requests = []
globalThis.localStorage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) }
globalThis.window = { acorn: {
  fleetList: async () => ({ nodes: ['A', 'B'].map((nodeId) => ({ nodeId, label: nodeId, endpoint: 'https://synthetic.invalid' })), statuses: ['A', 'B'].map((nodeId) => ({ nodeId, state: 'online' })) }),
  onNodeStatus: () => () => {},
  nodeFetch: async (nodeId, request) => {
    const body = JSON.parse(new TextDecoder().decode(request.body.bytes))
    requests.push({ nodeId, ...body })
    return { status: body.value.includes('reject') ? 500 : 200, headers: {}, body: new TextEncoder().encode(JSON.stringify({ key: body.key, value: body.value })) }
  },
} }
const { clientFor, setCacheStorage, refreshFleet, _resetFleet } = await load('packages/client-core/src/infra/node/fleet.ts')
const { setActiveNode } = await load('packages/client-core/src/infra/node/activeNode.ts')
const { savePref } = await load('packages/client-core/src/features/settings/savePref.ts')
const { createStartupRestore } = await load('packages/client-core/src/infra/persistence/startupRestore.ts')
const { storageKeyFor } = await load('packages/client-core/src/infra/persistence/persistedState.ts')
setCacheStorage({ getItem: async () => undefined, setItem: async () => {}, removeItem: async () => {} })
await refreshFleet()
const qA = clientFor('A').client, qB = clientFor('B').client
setActiveNode('A')
const saving = savePref(qA, 'origin-custody', 'A-value')
setActiveNode('B')
await saving
const origin = requests.find((request) => request.key === 'origin-custody')
qA.setQueryData(['prefs'], { shared: 'A-confirmed', other: 'A-confirmed' })
qB.setQueryData(['prefs'], { shared: 'B-confirmed', other: 'B-confirmed' })
await Promise.all([savePref(qA, 'shared', 'A-reject'), savePref(qB, 'shared', 'B-success')])
const failedA = qA.getQueryData(['prefs']).shared
await Promise.all([savePref(qA, 'other', 'A-new-confirmed'), savePref(qB, 'other', 'B-reject')])
const failedB = qB.getQueryData(['prefs']).other
setActiveNode('A')
const [state, setState] = createSignal({ task: { count: 0 } })
const descriptor = {
  id: 'synthetic.reversion', key: 'synthetic-reversion', scope: 'task', restore: 'panes', version: 1, unknownIds: 'retain-inert',
  codec: { parse: JSON.parse, serialize: (value) => value }, empty: () => ({ count: 0 }), binding: { values: state, hydrate: () => {} },
}
const key = storageKeyFor(descriptor, 'task')
const dispose = createRoot((dispose) => { createStartupRestore({ queryClient: qA, prefs: () => ({ [key]: '{"count":0}' }), ready: () => true, slices: () => [descriptor] }); return dispose })
await new Promise((resolve) => setTimeout(resolve, 0))
setState({ task: { count: 1 } }); setState({ task: { count: 0 } })
await new Promise((resolve) => setTimeout(resolve, 600))
const staleReversions = requests.filter((request) => request.key === key)
dispose()
const hashes = Object.fromEntries(['infra/node/fleet.ts', 'infra/node/apiClient.ts', 'features/settings/savePref.ts', 'infra/persistence/startupRestore.ts', 'infra/persistence/persistedState.ts'].map((path) => [path, createHash('sha256').update(readFileSync(join(root, 'packages/client-core/src', path))).digest('hex')]))
const result = { root, hashes, originTarget: origin.nodeId, failedAValue: failedA, failedBValue: failedB, reversionWrites: staleReversions, gates: { originA: origin.nodeId === 'A', independentFailedA: failedA === 'A-confirmed', independentFailedB: failedB === 'B-confirmed', noStaleReversion: staleReversions.length === 0 } }
writeFileSync(new URL(`./04-cache-custody-${tag}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
_resetFleet(); delete globalThis.window; delete globalThis.localStorage
process.exit(0)
