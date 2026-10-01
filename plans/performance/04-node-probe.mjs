// Replay from the repository root: rtk proxy node --expose-gc --import tsx plans/performance/04-node-probe.mjs
// Reads the shipped owners. Synthetic inputs and dependency injection only; no app data or PTYs.
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { OutputRing, RING_CAP } from '../../plugins/terminal/src/server/terminalUtils.ts'
import { TerminalDisplay, HeadlessTerminalScreen } from '../../plugins/terminal/src/server/terminalDisplay.ts'
import { RuntimeService } from '../../plugins/terminal/src/server/runtime.ts'

const results = { environment: { node: process.version, platform: process.platform, arch: process.arch }, ring: [] }
const emitResults = () => {
  const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.slice('--tag='.length)
  const json = JSON.stringify(results, null, 2) + '\n'
  if (tag) {
    if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use an alphanumeric tag.')
    writeFileSync(new URL(`./04-node-results-${tag}.json`, import.meta.url), json)
  }
  console.log(json)
}
const cpuMs = (before) => { const used = process.cpuUsage(before); return (used.user + used.system) / 1e3 }
const chunkArgument = process.argv.find((arg) => arg.startsWith('--chunks='))
const chunkSizes = chunkArgument ? chunkArgument.slice('--chunks='.length).split(',').map(Number) : [4096, 256, 64, 8, 1]
for (const chunkBytes of chunkSizes) {
  global.gc?.()
  const ring = new OutputRing()
  const chunk = 'x'.repeat(chunkBytes)
  const heapBefore = process.memoryUsage().heapUsed
  const arrayBuffersBefore = process.memoryUsage().arrayBuffers
  const start = performance.now()
  const cpuStart = process.cpuUsage()
  for (let bytes = 0; bytes < RING_CAP; bytes += chunkBytes) ring.push(chunk)
  const fillMs = performance.now() - start
  const fillCpuMs = cpuMs(cpuStart)
  global.gc?.()
  const heapDelta = process.memoryUsage().heapUsed - heapBefore
  const arrayBuffersDelta = process.memoryUsage().arrayBuffers - arrayBuffersBefore
  const overflowChunks = Math.min(8192, 32768 / chunkBytes)
  const overflowStart = performance.now()
  const overflowCpuStart = process.cpuUsage()
  for (let i = 0; i < overflowChunks; i++) ring.push(chunk)
  const overflowMs = performance.now() - overflowStart
  const overflowCpuMs = cpuMs(overflowCpuStart)
  results.ring.push({ chunkBytes, retainedBytes: ring.bytes, retainedChunks: ring.chunks?.length ?? null, heapDelta, arrayBuffersDelta,
    fillMs, fillCpuMs, overflowChunks, overflowMs, overflowCpuMs,
    tailValid: ring.tail() === 'x'.repeat(RING_CAP) })
}
if (process.argv.includes('--ring-only')) { emitResults(); process.exit(0) }

const listeners = new Set()
let spawned = 0
const running = new Set()
const killed = []
const svc = new RuntimeService({
  loadTargets: async () => ({ targets: [{ id: 'dev', command: 'fixture' }], cwd: '/tmp/fixture', repoTargetIds: [] }),
  authorizeRepoConfig: async () => {},
  startSession: async () => { const id = `s${++spawned}`; running.add(id); return id },
  onExit: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  isRunning: (id) => running.has(id), exitCode: () => 0,
  killSession: (id) => { running.delete(id); killed.push(id) },
  runScript: async () => ({ ok: true }),
})
const overlapping = await Promise.all(Array.from({ length: 8 }, () => svc.start('t1', 'dev')))
await svc.stop('t1', 'dev')
results.overlappingStart = { calls: 8, spawned, returnedSessions: overlapping.map((v) => v.sessionId),
  killed, surviving: [...running], trackedInstances: svc.instances.size }
for (let i = 0; i < 1000; i++) {
  const reply = await svc.start(`task-${i}`, 'dev')
  running.delete(reply.sessionId)
  for (const listener of listeners) listener(reply.sessionId, 0)
}
results.runTargetRetention = { completedDistinctTasks: 1000, trackedInstances: svc.instances.size,
  retainedExitCodes: svc.lastExitCodes.size, exitListenerCount: listeners.size }
svc.dispose()
results.runTargetRetention.afterDispose = { exitCodes: svc.lastExitCodes.size, exitListeners: listeners.size }

const ring = new OutputRing()
const ansi = '\x1b[32mfixture output\x1b[0m\r\n'.repeat(160)
for (let bytes = 0; bytes < 1024 * 1024; bytes += Buffer.byteLength(ansi)) ring.push(ansi)
const screenCpuStart = process.cpuUsage()
const screenStart = performance.now()
const screen = new HeadlessTerminalScreen(120, 40)
screen.write(ring.tail())
const snapshot = await screen.snapshot()
results.attachRebuild = { replayBytes: ring.bytes, snapshotBytes: Buffer.byteLength(snapshot),
  elapsedMs: performance.now() - screenStart, cpuMs: cpuMs(screenCpuStart) }
screen.dispose()

let resolveSnapshot
let disposed = 0
const display = new TerminalDisplay(80, 24, () => ({
  write() {}, resize() {}, snapshot: () => new Promise((resolve) => { resolveSnapshot = resolve }),
  dispose() { disposed++ },
}))
display.write('history')
const frames = []
display.attach((m) => frames.push(m), { id: 'fixture', cols: 80, rows: 24 }, () => 'history')
for (let i = 0; i < 1000; i++) display.publish({ type: 'output', data: 'x'.repeat(4096) })
results.attachPending = { pendingFrames: [...display.attaching.values()][0].frames.length,
  pendingBytes: [...display.attaching.values()][0].frames.reduce((sum, f) => sum + f.data.length, 0),
  emulating: display.emulating, deliveredBeforeSnapshot: frames.length }
resolveSnapshot('fixture snapshot')
await new Promise((resolve) => setTimeout(resolve, 0))
results.attachPending.afterSnapshot = { emulating: display.emulating, delivered: frames.length, screenDisposals: disposed }
display.dispose()

if (process.argv.includes('--parser-burst')) {
const require = createRequire(new URL('../../plugins/terminal/package.json', import.meta.url))
const { Terminal } = require('@xterm/headless')
const parser = new Terminal({ cols: 80, rows: 24 })
let acceptedBytes = 0
let firstError
for (let i = 0; i < 1024; i++) {
  try { parser.write('x'.repeat(65536)); acceptedBytes += 65536 }
  catch (error) { firstError = error.message; break }
}
results.parserBurst = { acceptedBytes, pendingData: parser._core._writeBuffer._pendingData, firstError,
  note: 'Synchronous synthetic producer; characterizes the actual xterm safety limit, not observed live traffic.' }
while (parser._core._writeBuffer._pendingData) await new Promise((resolve) => setTimeout(resolve, 10))
parser.dispose()
}
emitResults()
