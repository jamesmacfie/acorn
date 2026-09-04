/** @jsxImportSource @opentui/solid */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createComponent } from 'solid-js'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { renderCells } from '../kit/render'
import { Text } from '../kit/showing'

// What phase 5 promises, tested at the two levels it can be: the sandbox for real, and the drawing in
// cells (docs/tui.md).
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
test('a descriptor source keeps its region identity across chrome refreshes', async () => {
  const { sourcePanel } = await import('./SourcePanel')
  const descriptor = {
    id: 'identity', label: 'Issues', glyph: 'circle', order: 10, items: '/v2/p/probe/items',
  } as unknown as Parameters<typeof sourcePanel>[0]['descriptor']
  const first = sourcePanel({ pluginId: 'identity-probe', descriptor })
  const refreshed = sourcePanel({
    pluginId: 'identity-probe',
    descriptor: { ...descriptor, label: 'Open issues' },
  })

  expect(refreshed.regions!.list).toBe(first.regions!.list)
  expect(refreshed.regions!.detail).toBe(first.regions!.detail)
})

test('a descriptor source draws its list and its detail in cells', async () => {
  // What `client-core/host/chrome/sourcePanel.ts` exists for. The chrome registry used to name
  // `ChromeSourcePanel` directly, which is `<main class="panes">` and DOM kit primitives all the way
  // down, so selecting a descriptor source here threw "[Reconciler] Unknown component type: main"
  // instead of drawing anything. Both regions render, which is the whole claim.
  const { sourcePanel } = await import('./SourcePanel')
  const descriptor = {
    id: 'issues', label: 'Issues', glyph: 'circle', order: 10, items: '/v2/p/probe/items',
  } as unknown as Parameters<typeof sourcePanel>[0]['descriptor']
  const panel = sourcePanel({ pluginId: 'probe', descriptor })
  expect(panel.regions).toBeDefined()
  expect(panel.component).toBeUndefined()

  for (const region of [panel.regions!.list, panel.regions!.detail]) {
    const screen = await renderCells(() => createComponent(region, {}))
    // A real wait: the list runs a fan-out query and the detail asks the surface registry, and both
    // answer off a tick rather than off a frame.
    await new Promise((done) => setTimeout(done, 150))
    const drawn = await screen.frame()
    screen.done()
    // Anything at all, drawn without the reconciler refusing a node. A bare render has no node behind
    // it, so the list says it is loading and the detail says there is nothing to choose.
    expect(drawn.text.trim().length).toBeGreaterThan(0)
  }

  // A chrome resync must update descriptor data without replacing the region functions. Dynamic
  // treats those functions as component identities; replacing them remounts the list and loses its
  // caret, virtual window, and active query subscriptions.
  const refreshed = sourcePanel({
    pluginId: 'probe',
    descriptor: { ...descriptor, label: 'Open issues' },
  })
  expect(refreshed.regions!.list).toBe(panel.regions!.list)
  expect(refreshed.regions!.detail).toBe(panel.regions!.detail)

  const detail = await renderCells(() => createComponent(panel.regions!.detail, {}))
  expect((await detail.frame()).text).toContain('Open issues')
  sourcePanel({ pluginId: 'probe', descriptor: { ...descriptor, label: 'Tracked issues' } })
  expect((await detail.frame()).text).toContain('Tracked issues')
  detail.done()
}, 30_000)

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

// ── Reserved regions ──────────────────────────────────────────────────────────────────────────────

test('a pane that reserved a footer draws the rows delivered into it', async () => {
  // What `client-core/host/chrome/extendedPane.ts` exists for. The frame registry wrapped a loaded
  // plugin's pane in the DOM's `ExtendedPane` — a `div` around an `aside` holding a `PanelGrid` — so a
  // pane that declared a `pane.footer` or a `pane.aside` was refused by the reconciler rather than
  // drawn. This host's wrapper puts both under the owner's own tree (./ExtendedPane.tsx).
  // A node, because a contributor's rows come through the fleet fan-out and a fan-out over no nodes
  // answers with none (client-core/infra/node/fanout.ts).
  const { bootFixture } = await import('../harness')
  await bootFixture()
  const { extensionPointRegistry, extensionRegistry } = await import('@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts')
  const { ExtendedPane } = await import('./ExtendedPane')
  const point = { pointId: 'board:card-links', region: { columns: 2, rows: 2 } } as never

  const points = extensionPointRegistry.register({
    id: 'board:card-links',
    ownerId: 'board',
    label: 'Linked items',
    kind: 'rows' as const,
    location: 'pane.footer' as const,
    surface: 'board',
    max: 4,
  })
  const rows = extensionRegistry.register({
    id: 'tracker:links',
    pluginId: 'tracker',
    point: 'board:card-links',
    label: 'Tracked items',
    order: 10,
    carrier: 'items' as const,
    fetch: async () => [{ id: 'i-1', title: 'ACORN-14', subtitle: 'in review' }],
  })

  try {
    const screen = await renderCells(() => (
      <ExtendedPane footerPointId="board:card-links" aside={point}>
        <Text>the pane itself</Text>
      </ExtendedPane>
    ))
    // A real wait: the rows come off a fan-out query, which answers on a tick rather than on a frame.
    await new Promise((done) => setTimeout(done, 200))
    const drawn = await screen.frame()
    screen.done()

    expect(drawn.text).not.toContain('Unknown component type')
    expect(drawn.text).toContain('the pane itself')
    // The contributor's rows, its label, and the stamp saying whose they are.
    expect(drawn.text).toContain('ACORN-14')
    expect(drawn.text).toContain('Tracked items')
    expect(drawn.text).toContain('tracker')
    // …and the aside named rather than drawn: a dashboard is a grid sized in pixels, and its terminal
    // projection is the dashboards programme's question (docs/tui.md § What a plugin loses here).
    expect(drawn.text).toContain('board:card-links is a dashboard')
  } finally {
    rows.dispose()
    points.dispose()
  }
}, 30_000)

// ── Two paths, one kit ────────────────────────────────────────────────────────────────────────────

test('a tree drawn from a batch and the same tree written as JSX draw the same cells', async () => {
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
  // A real wait, not just a settle. A batch lands on the shell's own tick rather than on a frame
  // (../kit/tick.ts), and `renderCells`'s settle resolves off the render loop in a microtask — so it
  // comes back before that timer has run, and a renderer whose tree was still empty has never painted
  // at all, which reads as an uninitialised buffer rather than a blank screen.
  await new Promise((done) => setTimeout(done, 100))
  const drawn = await remote.frame()
  remote.done()

  const compiled = await renderCells(() => <Text emphasis="strong">from a worker</Text>)
  const written = compiled.lines
  compiled.done()

  expect(drawn.lines).toEqual(written)
}, 30_000)
