import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
const held = vi.hoisted(() => ({ bundle: '', workers: [] as any[], messages: [] as any[] }))
vi.mock('../../apps/tui/src/plugins/custody', () => ({ bundlePath: () => held.bundle }))
vi.mock('node:worker_threads', async (original) => { const actual = await original<any>(); return { ...actual, Worker: class extends actual.Worker { constructor(...args: any[]) { super(...args); held.workers.push(this); this.on('message', (message: unknown) => held.messages.push(message)) } } } })
import { installPluginWorkers } from '../../apps/tui/src/plugins/workerFactory'
import { acquireTreeWorker, _stopAllTreeWorkers, _setWorkerFactory } from '../../packages/client-core/src/host/tree/workerHost'
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const waitFor = async (check: () => boolean) => { const until = Date.now() + 3000; while (!check()) { if (Date.now() > until) throw new Error('bounded wait expired'); await delay(5) } }
it('records unread captured stdout stalling a permission sandbox until explicitly drained', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'; const output = `plans/performance/16-stdout-${tag}.json`
  if (tag.startsWith('before') && existsSync(output)) throw new Error('Before exists')
  const dir = mkdtempSync(join(tmpdir(), 'acorn-perf-worker-')); held.bundle = join(dir, 'bundle.mjs')
  writeFileSync(held.bundle, `
    addEventListener('message', (event) => { const tree = event.ports[1]; tree.onmessage = (message) => { if (message.data.kind === 'tree:ping') tree.postMessage({kind:'tree:pong'}) }; });
    postMessage({ started: true, stdout: 0 });
    let written = 0; const chunk = 'x'.repeat(4096);
    while (written < 256 * 1024) { written += chunk.length; if (!process.stdout.write(chunk)) { postMessage({ paused: true, stdout: written }); await new Promise((resolve) => process.stdout.once('drain', resolve)); } }
    postMessage({ finished: true, stdout: written });
  `)
  let handle: any
  try {
    installPluginWorkers(); handle = acquireTreeWorker({ pluginId: 'audit', hash: 'a'.repeat(64), connect: () => ({ dispose() {} }), onRefused() {} }); handle.mount('s1', 'probe', {})
    await waitFor(() => held.messages.some((m) => m.paused)); await delay(80)
    const worker = held.workers[0], before = { messages: [...held.messages], finished: held.messages.some((m) => m.finished), stdoutReadableLength: worker.stdout.readableLength, stderrReadableLength: worker.stderr.readableLength }
    expect(before.finished).toBe(false)
    let discardedBytes = 0; worker.stdout.on('data', (chunk: Buffer) => { discardedBytes += chunk.byteLength }); worker.stderr.resume(); await waitFor(() => held.messages.some((m) => m.finished))
    writeFileSync(output, JSON.stringify({ fixture: 'Actual TUI workerFactory, Node Worker, permission bootstrap and workerHost. Synthetic bundle emits 256KiB and honors stdout drain; no output bytes printed to host screen.', beforeDrain: before, afterDrain: { finished: true, discardedBytes, messages: held.messages } }, null, 2) + '\n')
  } finally { handle?.unmount('s1'); handle?.release(); _stopAllTreeWorkers(); _setWorkerFactory(null); await Promise.all(held.workers.map((worker) => worker.terminate())); rmSync(dir, { recursive: true, force: true }) }
})
