import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MessageChannel, Worker } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
const held = vi.hoisted(() => ({ path: '', factory: null as any }))
vi.mock('../../apps/tui/src/plugins/custody', () => ({ bundlePath: () => held.path }))
vi.mock('@acorn/client-core/host/tree/workerHost.ts', () => ({ _setWorkerFactory: (factory: any) => { held.factory = factory } }))
import { installPluginWorkers } from 'unit06-worker-factory'
it('compares actual permission-scoped noisy workers with bounded host observation', async () => {
  const before = process.env.ACORN_PERF_OWNER === 'before'
  const directory = mkdtempSync(join(tmpdir(), 'acorn-noisy-factory-probe-'))
  held.path = join(directory, 'noisy.mjs')
  writeFileSync(held.path, `
    const chunk = 'noisy-plugin-output'.repeat(8192)
    for (const stream of [process.stdout, process.stderr]) {
      for (let i = 0; i < 64; i++) await new Promise(resolve => stream.write(chunk) ? resolve() : stream.once('drain', resolve))
    }
    postMessage({ phase: 'output-complete' })
  `)
  const workers: Worker[] = [], messages: any[] = []
  const realPost = Worker.prototype.postMessage
  const post = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message, transfer) {
    if ((message as any).acornBridge && !workers.includes(this)) { workers.push(this); this.on('message', (message) => messages.push(message)) }
    return realPost.call(this, message, transfer)
  })
  const bridge = new MessageChannel(), tree = new MessageChannel()
  let adapter: any
  try {
    installPluginWorkers()
    adapter = held.factory('/plugin-worker/noisy-proof.js')
    adapter.postMessage({ acornBridge: 1 }, [bridge.port2, tree.port2])
    const until = Date.now() + 1500
    while (!messages.some((message) => message.phase === 'output-complete') && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5))
    const completed = messages.some((message) => message.phase === 'output-complete')
    expect(completed).toBe(!before)
    const result = { before, completedWithinFixtureDeadlineMs: 1500, completed, workers: workers.length,
      stdout: { flowing: workers[0].stdout?.readableFlowing, bufferedBytes: workers[0].stdout?.readableLength, dataListeners: workers[0].stdout?.listenerCount('data') },
      stderr: { flowing: workers[0].stderr?.readableFlowing, bufferedBytes: workers[0].stderr?.readableLength, dataListeners: workers[0].stderr?.listenerCount('data') }, outputCharacters: 'noisy-plugin-output'.length * 8192 * 64 * 2 }
    writeFileSync(join(dirname(fileURLToPath(import.meta.url)), `evidence/unit06-noisy-factory-${before ? 'before' : 'after'}.json`), JSON.stringify(result, null, 2)+'\n', { flag: 'wx' })
  } finally {
    adapter?.terminate()
    await Promise.all(workers.map((worker) => worker.terminate()))
    bridge.port1.close(); bridge.port2.close(); tree.port1.close(); tree.port2.close()
    post.mockRestore(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true })
  }
})
