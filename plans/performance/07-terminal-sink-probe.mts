// Actual broker, hub and display over an ephemeral loopback server. No PTY or private profile.
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { readFileSync, writeFileSync } from 'node:fs'
import { NodeBroker } from '../../packages/custody/src/broker/nodeBroker.ts'
import { attachWsHub, disposeWsHub, setStreamHandlers } from '../../packages/node-core/src/server/transport/wsHub.ts'
import { TerminalDisplay } from '../../plugins/terminal/src/server/terminalDisplay.ts'

const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const frames = JSON.parse(readFileSync(new URL('./07-terminal-switch-before.json', import.meta.url), 'utf8'))
const initial = frames.afterSwitch[0]
const sessionId = initial.frame.id
const nodeId = initial.nodeId
const counters = { attaches: 0, detaches: 0, activeSinks: 0, readyFrames: 0, binaryFrames: 0, binaryBytes: 0, snapshots: 0, screenFactories: 0, screenDisposals: 0 }
const display = new TerminalDisplay(80, 24, () => {
  counters.screenFactories++
  return { write() {}, resize() {}, snapshot: async () => { counters.snapshots++; return 'synthetic-screen' }, dispose: () => { counters.screenDisposals++ } }
})
display.write('synthetic-history')
const server = createServer((_request, response) => response.end(JSON.stringify({ baseline: 'acorn-1', protocolVersion: 1, fingerprint: 'synthetic' })))
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as any).port
setStreamHandlers({ input() {}, streamTaskId: () => null,
  attach: (_id, sink) => { counters.attaches++; counters.activeSinks++; display.attach(sink as never, { id: sessionId } as never, () => 'synthetic-history') },
  detach: (_id, sink) => { counters.detaches++; counters.activeSinks--; display.detach(sink as never) },
})
attachWsHub(server, { internalToken: 'synthetic', allowedHosts: new Set([`127.0.0.1:${port}`]), devices: { authenticate: async () => ({ deviceId: 'synthetic-device' }), onRevoked: () => () => {}, isActive: async () => true } as never })
const broker = new NodeBroker({ frame: (_id, frame) => { if (frame.channel === 'term:out' && (frame as any).msg?.type === 'ready') counters.readyFrames++ }, bytes: (_id, value) => { counters.binaryFrames++; counters.binaryBytes += value.byteLength }, status() {} })
const until = async (condition: () => boolean) => {
  const deadline = performance.now() + 3_000
  while (!condition()) { if (performance.now() > deadline) throw new Error('bounded wait expired'); await new Promise(resolve => setTimeout(resolve, 5)) }
}
try {
  broker.upsert({ nodeId, label: 'synthetic', local: true, endpoint: `http://127.0.0.1:${port}`, token: 'synthetic-device-token' })
  broker.send(nodeId, initial.frame)
  await until(() => counters.readyFrames === 1 && counters.binaryFrames === 1 && !display.emulating)
  const firstAttach = { ...counters, emulating: display.emulating }
  // The real channel's recorded Node-switch sequence contains no A detach. Keep A's broker socket.
  const beforeOutput = { ...counters }
  const cpuBefore = process.cpuUsage()
  const at = performance.now()
  for (let i = 0; i < 128; i++) display.publish({ type: 'output', data: 'x'.repeat(4_096) })
  await until(() => counters.binaryFrames - beforeOutput.binaryFrames === 128)
  const cpu = process.cpuUsage(cpuBefore)
  const inactiveOutput = { frames: counters.binaryFrames - beforeOutput.binaryFrames, encodedBytes: counters.binaryBytes - beforeOutput.binaryBytes,
    activeSinks: counters.activeSinks, emulating: display.emulating, elapsedMs: performance.now() - at, processCpuMs: (cpu.user + cpu.system) / 1000 }
  const beforeReturn = { ...counters }
  broker.send(nodeId, initial.frame)
  await new Promise(resolve => setTimeout(resolve, 40))
  const returnAttach = { attaches: counters.attaches - beforeReturn.attaches, readyFrames: counters.readyFrames - beforeReturn.readyFrames,
    snapshots: counters.snapshots - beforeReturn.snapshots, activeSinks: counters.activeSinks }
  broker.send(nodeId, { channel: 'term:detach', id: sessionId })
  await until(() => counters.activeSinks === 0)
  const beforeRecovery = { ...counters }
  broker.send(nodeId, initial.frame)
  await until(() => counters.readyFrames > beforeRecovery.readyFrames && !display.emulating)
  const afterExplicitDetachAndReturn = { attaches: counters.attaches - beforeRecovery.attaches, readyFrames: counters.readyFrames - beforeRecovery.readyFrames,
    snapshots: counters.snapshots - beforeRecovery.snapshots, activeSinks: counters.activeSinks }
  const result = { environment: { node: process.version, platform: process.platform, arch: process.arch, commit: 'f8e4b59c', synthetic: true },
    fixture: 'actual NodeBroker, wsHub and TerminalDisplay with synthetic screen; source channel frames replayed; no PTY, helper filter or WebKit',
    firstAttach, inactiveOutput, returnAttach, afterExplicitDetachAndReturn }
  writeFileSync(new URL(`./07-terminal-sink-${tag}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  broker.dispose(); disposeWsHub(server); setStreamHandlers(null); display.dispose(); server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
