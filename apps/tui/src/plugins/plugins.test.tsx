/** @jsxImportSource @opentui/solid */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { hasFfi } from '../ffi'
import { renderCells } from '../kit/render'
import { Text } from '../kit/showing'

// What phase 5 promises, tested at the two levels it can be: the sandbox for real, and the drawing in
// cells (docs/future/terminal/phase-5-loaded-plugins.md § Tests).
//
// The sandbox half never skips. It starts a real `node:worker_threads` worker under `--permission`,
// hands it a bundle out of a real content-addressed cache, and asserts both halves of the containment
// claim: the batch it sends arrives, and the file it was not granted does not open. None of that needs
// a terminal, so it runs on whatever Node the repo is on.
//
// The drawing half skips without `node:ffi`, like every other test that renders (../ffi.ts).

let config: string

beforeEach(async () => {
  config = mkdtempSync(join(tmpdir(), 'acorn-tui-plugins-'))
  process.env.ACORN_TUI_CONFIG_DIR = config
  const { _resetPluginCustody } = await import('./custody')
  _resetPluginCustody()
})

afterEach(async () => {
  const { _stopAllTreeWorkers } = await import('@acorn/client-core/host/tree/workerHost.ts')
  _stopAllTreeWorkers()
  const { _setWorkerFactory } = await import('@acorn/client-core/host/tree/workerHost.ts')
  _setWorkerFactory(null)
  delete process.env.ACORN_TUI_CONFIG_DIR
  rmSync(config, { recursive: true, force: true })
})

/** A broker that hands back whatever bytes the test wants, which is the whole of `PluginCache`'s
 *  dependency on one. */
const brokerServing = (bytes: string) => ({
  fetch: async () => ({ requestId: 'r', status: 200, headers: {}, body: new TextEncoder().encode(bytes) }),
})

// ── Custody ───────────────────────────────────────────────────────────────────────────────────────

test('a bundle whose bytes do not match its hash is refused and never cached', async () => {
  const { createPluginCustody } = await import('./custody')
  const custody = createPluginCustody(brokerServing('export const hello = 1'))

  const lie = 'a'.repeat(64)
  const result = await custody.cachePut({ nodeId: 'node-1', pluginId: 'liar', hash: lie, version: '1.0.0' })

  expect(result).toEqual({ error: 'hash-mismatch' })
  expect((await custody.state()).cached).toEqual({})
})

test('a bundle the node hashed honestly is cached under the bytes this device hashed', async () => {
  const source = 'export const hello = 1'
  const hash = createHash('sha256').update(source).digest('hex')
  const { createPluginCustody, bundlePath } = await import('./custody')
  const custody = createPluginCustody(brokerServing(source))

  expect(await custody.cachePut({ nodeId: 'node-1', pluginId: 'honest', hash, version: '1.0.0' })).toEqual({ hash })
  expect((await custody.state()).cached[hash]).toMatchObject({ pluginId: 'honest', version: '1.0.0' })
  // The one path-shaped answer, and its only caller is the worker factory.
  expect(bundlePath(hash)).toContain(hash)
})

test('a decision is recorded per (plugin, bundle), and only for bundles this device holds', async () => {
  const source = 'export const hello = 1'
  const hash = createHash('sha256').update(source).digest('hex')
  const { createPluginCustody } = await import('./custody')
  const custody = createPluginCustody(brokerServing(source))
  await custody.cachePut({ nodeId: 'node-1', pluginId: 'p', hash, version: '1.0.0' })

  const decision = {
    pluginId: 'p',
    hash,
    nodeId: 'node-1',
    version: '1.0.0',
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
    webviews: [],
    keyClaims: [],
    extensions: [],
    schedules: [],
    taskChecks: [],
    harnesses: [],
    decision: 'accepted' as const,
  }
  await custody.trustRecord(decision)
  expect((await custody.state()).acks).toMatchObject([{ pluginId: 'p', hash, decision: 'accepted' }])

  // Not a hash this device holds. Refused rather than recorded, because a decision is about bytes.
  await expect(custody.trustRecord({ ...decision, hash: 'b'.repeat(64) })).rejects.toThrow(/No cached bundle/)
  expect((await custody.state()).acks).toHaveLength(1)

  // Re-deciding the same bundle replaces the row rather than appending one.
  await custody.trustRecord({ ...decision, decision: 'rejected' })
  expect((await custody.state()).acks).toMatchObject([{ hash, decision: 'rejected' }])
})

// ── The sandbox ───────────────────────────────────────────────────────────────────────────────────

/** A bundle that answers the handshake, reports whether the filesystem let it out, and sends one
 *  batch on mount. Written as source rather than built, because what is under test is the sandbox and
 *  not a plugin's build. */
const PROBE_BUNDLE = `
let reach = 'unknown'
try {
  const fs = await import('node:fs/promises')
  await fs.readFile('/etc/hosts', 'utf8')
  reach = 'read a file it was not granted'
} catch (error) {
  reach = String(error.code ?? error.message)
}
let net = 'unknown'
try {
  await import('node:net')
  net = 'imported node:net'
} catch (error) {
  net = 'no net'
}
addEventListener('message', (event) => {
  const tree = event.ports[1]
  tree.onmessage = (message) => {
    if (message.data.kind !== 'tree:mount') return
    tree.postMessage({
      kind: 'tree:batch',
      slot: message.data.slot,
      ops: [{
        op: 'insert',
        parent: null,
        index: 0,
        node: { id: 'n1', type: 'Text', props: {}, children: [{ id: 't1', type: '#text', props: { value: reach + ' / ' + net }, children: [] }] },
      }],
    })
  }
})
`

/** Put a bundle in the cache, install the terminal's worker factory, and mount one slot. */
async function mountProbe(source: string): Promise<{ ops: readonly TreeMutation[]; refusals: string[]; release: () => void }> {
  const { createPluginCustody } = await import('./custody')
  const { installPluginWorkers } = await import('./workerFactory')
  const { acquireTreeWorker } = await import('@acorn/client-core/host/tree/workerHost.ts')

  // Through the real custody path, so the bytes on disk are the bytes this device hashed and the
  // worker is pointed at a bundle the way one is in production.
  const hash = createHash('sha256').update(source).digest('hex')
  const custody = createPluginCustody(brokerServing(source))
  expect(await custody.cachePut({ nodeId: 'node-1', pluginId: 'probe', hash, version: '1.0.0' })).toEqual({ hash })
  installPluginWorkers()

  const refusals: string[] = []
  const worker = acquireTreeWorker({
    pluginId: 'probe',
    hash,
    onRefused: (reason) => refusals.push(reason),
    connect: () => ({ dispose: () => {} }),
  })
  const batches: TreeMutation[] = []
  const transport = worker.transport('s1')
  const seen = new Promise<void>((done) => {
    transport.onBatch((ops) => {
      batches.push(...ops)
      done()
    })
    transport.onFailed((message) => {
      refusals.push(message)
      done()
    })
  })
  worker.mount('s1', 'main', {})
  await Promise.race([seen, new Promise((done) => setTimeout(done, 10_000))])
  return { ops: batches, refusals, release: () => { worker.unmount('s1'); worker.release() } }
}

test('a plugin worker draws its tree and cannot read a file it was not granted', async () => {
  const { ops, refusals, release } = await mountProbe(PROBE_BUNDLE)
  release()

  expect(refusals).toEqual([])
  expect(ops).toHaveLength(1)
  const insert = ops[0]!
  expect(insert.op).toBe('insert')
  const text = insert.op === 'insert' ? String(insert.node.children[0]?.props.value ?? '') : ''
  // The permission model refused the read, and the module hook refused the import. Between them the
  // bridge's port is the only way out of the worker, which is the containment claim
  // (docs/security.md § Rung 0 — The client sandbox).
  expect(text).toContain('ERR_ACCESS_DENIED')
  expect(text).toContain('no net')
}, 30_000)

test('a worker that dies at module scope fails its slot rather than hanging', async () => {
  const { refusals, release } = await mountProbe('throw new Error("this bundle is broken")')
  release()

  expect(refusals.join(' ')).toContain('this bundle is broken')
}, 30_000)

// ── Two paths, one kit ────────────────────────────────────────────────────────────────────────────

test.skipIf(!hasFfi)('a tree drawn from a batch and the same tree written as JSX draw the same cells', async () => {
  const { TreeHost } = await import('./TreeHost')
  const ops: TreeMutation[] = [{
    op: 'insert',
    parent: null,
    index: 0,
    node: { id: 'n1', type: 'Text', props: { emphasis: 'strong' }, children: [{ id: 't1', type: '#text', props: { value: 'from a worker' }, children: [] }] },
  }]

  let send: ((batch: readonly TreeMutation[]) => void) | undefined
  const remote = await renderCells(() => (
    <TreeHost
      pluginId="probe"
      transport={{
        onBatch: (listener) => { send = listener; return () => {} },
        onFailed: () => () => {},
        send: () => {},
      }}
    />
  ))
  send!(ops)
  const drawn = await remote.frame()
  remote.done()

  const compiled = await renderCells(() => <Text emphasis="strong">from a worker</Text>)
  const written = compiled.lines
  compiled.done()

  expect(drawn.lines).toEqual(written)
}, 30_000)
