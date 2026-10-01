import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinModules } from 'node:module'
import { Worker as NodeWorker } from 'node:worker_threads'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { _setWorkerFactory, _stopAllTreeWorkers, acquireTreeWorker } from '@acorn/client-core/host/tree/workerHost.ts'
import { _resetPluginCustody, createPluginCustody } from './custody'
import { installPluginWorkers } from './workerFactory'
import { pluginBuiltinAllowed } from '@acorn/protocol/plugin/nodeBuiltins.ts'

let config: string
beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'acorn-tui-worker-isolation-'))
  process.env.ACORN_TUI_CONFIG_DIR = config
  _resetPluginCustody()
})
afterEach(() => {
  _stopAllTreeWorkers()
  _setWorkerFactory(null)
  delete process.env.ACORN_TUI_CONFIG_DIR
  rmSync(config, { recursive: true, force: true })
})

/** Hash and cache fixture bytes, then exercise the actual permission-scoped client worker. */
async function mountProbe(source: string) {
  const hash = createHash('sha256').update(source).digest('hex')
  const custody = createPluginCustody({
    fetch: async () => ({ requestId: 'fixture', status: 200, headers: {}, body: new TextEncoder().encode(source) }),
  })
  expect(await custody.cachePut({ nodeId: 'node-1', pluginId: 'probe', hash, version: '1.0.0' })).toEqual({ hash })
  installPluginWorkers()
  const refusals: string[] = []
  const worker = acquireTreeWorker({
    pluginId: 'probe', hash, onRefused: (reason) => refusals.push(reason),
    connect: () => ({ dispose: () => {} }),
  })
  const ops: TreeMutation[] = []
  const transport = worker.transport('fixture-slot')
  const seen = new Promise<void>((done) => {
    transport.onBatch((batch) => { ops.push(...batch); done() })
    transport.onFailed((message) => { refusals.push(message); done() })
  })
  worker.mount('fixture-slot', 'main', {})
  await Promise.race([seen, new Promise((done) => setTimeout(done, 10_000))])
  return { ops, refusals, release: () => { worker.unmount('fixture-slot'); worker.release() } }
}

/** Return bounded fixture data through the same ready/mount/tree path as a loaded client. */
const reportingBundle = (evaluate: string, commonJs: boolean) => `
${commonJs ? '' : 'export {}'}
const result = ${commonJs ? '' : 'await'} (${commonJs ? '' : 'async'} () => { ${evaluate} })()
addEventListener('message', (event) => {
  // Complete the legacy SDK acknowledgement before serving the tree.
  event.ports[0].postMessage({ kind: 'connected' })
  const tree = event.ports[1]
  tree.onmessage = (event) => {
    if (event.data.kind !== 'tree:mount') return
    tree.postMessage({ kind: 'tree:batch', slot: event.data.slot, ops: [{
      op: 'insert', parent: null, index: 0,
      node: { id: 'n1', type: 'Text', props: {}, children: [
        { id: 't1', type: '#text', props: { value: JSON.stringify(result) }, children: [] },
      ] },
    }] })
  }
  tree.postMessage({ kind: 'tree:ready', version: 1, entries: ['main'] })
})
`

async function workerReport(evaluate: string, commonJs = false): Promise<unknown> {
  const { ops, refusals, release } = await mountProbe(reportingBundle(evaluate, commonJs))
  release()
  expect(refusals).toEqual([])
  expect(ops).toHaveLength(1)
  const op = ops[0]!
  if (op.op !== 'insert') throw new Error('The fixture did not draw its report')
  return JSON.parse(String(op.node.children[0]?.props.value))
}

test('loaded client workers receive no parent environment before bundle evaluation', async () => {
  const key = 'ACORN_SECURITY_TEST_CLIENT_SENTINEL'
  const original = process.env[key]
  process.env[key] = 'dummy-parent-value'
  try {
    expect(await workerReport(`
      const importedProcess = (await import('node:process')).default
      return {
        sentinel: process.env.${key} ?? null,
        importedSentinel: importedProcess.env.${key} ?? null,
        keys: Object.keys(process.env),
      }
    `)).toEqual({ sentinel: null, importedSentinel: null, keys: [] })
  } finally {
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
}, 30_000)

test('cached process ESM namespace receives the guarded accessor before client evaluation', async () => {
  const bootstrap = realpathSync(fileURLToPath(new URL('./pluginWorker.js', import.meta.url)))
  const wrapper = join(realpathSync(config), 'trusted-preload.mjs')
  const bundle = join(realpathSync(config), 'identity-probe.mjs')
  // Simulate trusted bootstrap load order without acquiring a denied module or performing native
  // effects. A cached ESM namespace's live binding must agree with the new process property.
  writeFileSync(wrapper, `globalThis.cachedProcess = await import('node:process'); await import(${JSON.stringify(pathToFileURL(bootstrap).href)})`)
  writeFileSync(bundle, `import { getBuiltinModule } from 'node:process'; postMessage({
    cachedMatches: globalThis.cachedProcess.getBuiltinModule === process.getBuiltinModule,
    freshMatches: getBuiltinModule === process.getBuiltinModule,
    harmless: getBuiltinModule('node:path').basename('/synthetic/file'),
  })`)
  const worker = new NodeWorker(wrapper, {
    workerData: { bundle, builtins: builtinModules
      .filter(name => pluginBuiltinAllowed(name, { sockets: false, exec: false }))
      .map(name => name.replace(/^node:/, '')) },
    env: {}, stdout: true, stderr: true,
    execArgv: ['--permission', ...[wrapper, bootstrap, bundle].map(path => `--allow-fs-read=${path}`)],
  })
  try {
    const report = await new Promise<unknown>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`Fixture worker exited before reporting (${code})`)))
    })
    expect(report).toEqual({ cachedMatches: true, freshMatches: true, harmless: 'file' })
  } finally { await worker.terminate() }
}, 30_000)

test('loaded client builtin imports and synchronous accessors share the restrictive policy', async () => {
  // Acquiring the module is refused. No network, subprocess, inspector or native effect is attempted.
  const denied = ['net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'dns/promises', 'quic',
    'child_process', 'worker_threads', 'cluster', 'module', 'vm', 'inspector', 'inspector/promises',
    'repl', '_http_server', 'internal/fs/utils', 'test', 'sqlite', 'ffi']
  expect(await workerReport(`
    const failures = []
    const importedProcess = (await import('node:process')).default
    const { getBuiltinModule: importedAccessor } = await import('node:process')
    for (const name of ${JSON.stringify(denied)}) {
      for (const specifier of [name, 'node:' + name]) {
        for (const [carrier, acquire] of [
          ['import', () => import(specifier)],
          ['process', () => process.getBuiltinModule(specifier)],
          ['imported-process', () => importedProcess.getBuiltinModule(specifier)],
          ['named-process', () => importedAccessor(specifier)],
        ]) {
          try { await acquire(); failures.push(carrier + ':' + specifier) }
          catch {}
        }
      }
    }
    const { createHash } = await import('node:crypto')
    const path = process.getBuiltinModule('path')
    const fs = await import('node:fs/promises')
    return {
      failures,
      harmless: createHash('sha256').update('dummy').digest('hex').length === 64 && path.basename('/dummy/file') === 'file',
      safeSubpath: typeof fs.readFile === 'function',
      require: typeof globalThis.require,
      mainModule: typeof process.mainModule,
      networkGlobals: ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'navigator'].filter((name) => name in globalThis),
    }
  `)).toEqual({ failures: [], harmless: true, safeSubpath: true, require: 'undefined', mainModule: 'undefined', networkGlobals: [] })
}, 30_000)

test('CommonJS-shaped cached clients cannot acquire privileged builtin families through require', async () => {
  expect(await workerReport(`
    const failures = []
    for (const name of ['net', 'dns/promises', 'inspector/promises', 'module', 'child_process',
      'worker_threads', '_http_server', 'internal/fs/utils', 'sqlite']) {
      for (const specifier of [name, 'node:' + name]) {
        try { require(specifier); failures.push(specifier) }
        catch {}
        try { require('node:process').getBuiltinModule(specifier); failures.push('process:' + specifier) }
        catch {}
      }
    }
    return { failures, require: typeof require, harmless: require('node:path').basename('/dummy/file') }
  `, true)).toEqual({ failures: [], require: 'function', harmless: 'file' })
}, 30_000)
