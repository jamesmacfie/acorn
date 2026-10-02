import { MessageChannel, Worker } from 'node:worker_threads'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { PluginRpcEndpoint } from '../../packages/node-core/src/server/plugins/pluginRpc'
import { search, setSearchBridge, type SearchBridge } from '../../plugins/editor/src/server/routes/search'

it('forwards a held route cancellation through a worker Request to actual ripgrep exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acorn-search-rpc-'))
  await writeFile(join(root, 'fixture.txt'), 'needle\n'.repeat(100000))
  const { port1, port2 } = new MessageChannel()
  // SIGSTOP holds only this disposable child until caller cancellation reaches its owner.
  const worker = new Worker(`
    const { workerData, parentPort } = require('node:worker_threads');
    require('tsx/esm/api').register({ parentURL: ${JSON.stringify(pathToFileURL(resolve('package.json')).href)} });
    const cp = require('node:child_process');
    const original = cp.spawn;
    cp.spawn = (...args) => { const child = original(...args); child.kill('SIGSTOP'); parentPort.postMessage({ kind: 'started', pid: child.pid }); return child; };
    require('node:module').syncBuiltinESMExports();
    (async () => {
      const { PluginRpcEndpoint } = await import(${JSON.stringify(pathToFileURL(resolve('packages/node-core/src/server/plugins/pluginRpc.ts')).href)});
      const { searchBridge } = await import(${JSON.stringify(pathToFileURL(resolve('plugins/editor/src/server/search.ts')).href)});
      const endpoint = new PluginRpcEndpoint(workerData.port, () => 'async');
      const bridge = searchBridge({ tasks: { root: async () => workerData.root } });
      workerData.port.postMessage(await endpoint.encode({ findInFiles: async (...args) => {
        try { return await bridge.findInFiles(...args); }
        finally { parentPort.postMessage({ kind: 'joined' }); }
      } }));
    })().catch(error => { throw error });
  `, { eval: true, workerData: { port: port2, root }, transferList: [port2] })
  const host = new PluginRpcEndpoint(port1, () => 'async')
  let pid: number | undefined
  try {
    const bridge = host.decode(await new Promise((resolve, reject) => { port1.once('message', resolve); worker.once('error', reject) })) as SearchBridge
    setSearchBridge(bridge)
    const started = new Promise<number>((resolve) => worker.on('message', (message) => { if (message.kind === 'started') resolve(message.pid) }))
    const joined = new Promise<void>((resolve) => worker.on('message', (message) => { if (message.kind === 'joined') resolve() }))
    const controller = new AbortController()
    const app = new Hono().route('/tasks', search)
    const response = app.fetch(new Request('http://acorn.test/tasks/task/search', {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'needle' }),
    }))
    const settled = response.catch((error: unknown) => error)
    pid = await started
    controller.abort()
    await settled
    await joined
    expect(() => process.kill(pid!, 0)).toThrow()
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch {} }
    setSearchBridge(null)
    host.close(new Error('done'))
    await worker.terminate()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
