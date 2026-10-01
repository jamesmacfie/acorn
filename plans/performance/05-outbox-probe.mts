import { NodeBroker } from '../../packages/custody/src/broker/nodeBroker.ts'
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { attachWsHub, disposeWsHub, setStreamHandlers } from '../../packages/node-core/src/server/transport/wsHub.ts'
import { TerminalDisplay } from '../../plugins/terminal/src/server/terminalDisplay.ts'

// Call the owning method against one synthetic disconnected connection. No sockets or timers start.
const nodeId = '00000000-0000-4000-8000-000000000001'
const terminalId = '00000000-0000-4000-8000-000000000003'
const outbox: string[] = []
const owner = { connections: new Map([[nodeId, { ws: null, outbox }]]) }
for (let i = 0; i < 1_000; i += 1) {
  NodeBroker.prototype.send.call(owner as never, nodeId, { channel: 'term:attach', id: terminalId })
  NodeBroker.prototype.send.call(owner as never, nodeId, { channel: 'term:detach', id: terminalId })
}
async function flushToHub() {
  let attaches = 0
  let detaches = 0
  let activeSinks = 0
  let screenFactoryCalls = 0
  let snapshots = 0
  let replayWrites = 0
  let screenDisposals = 0
  const display = new TerminalDisplay(80, 24, () => {
    screenFactoryCalls += 1
    return { write: () => { replayWrites += 1 }, resize: () => {}, snapshot: async () => { snapshots += 1; return '' }, dispose: () => { screenDisposals += 1 } }
  })
  display.write('synthetic-history')
  const server = createServer((_request, response) => response.end(JSON.stringify({ baseline: 'acorn-1', protocolVersion: 1, fingerprint: 'synthetic' })))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  setStreamHandlers({ input: () => {}, streamTaskId: () => null, attach: (_id, sink) => { attaches += 1; activeSinks += 1; display.attach(sink as never, { id: terminalId } as never, () => 'synthetic-history') }, detach: (_id, sink) => { detaches += 1; activeSinks -= 1; display.detach(sink as never) } })
  attachWsHub(server, { internalToken: 'synthetic', allowedHosts: new Set([`127.0.0.1:${port}`]), devices: { authenticate: async () => ({ deviceId: 'synthetic-device' }), onRevoked: () => () => {}, isActive: async () => true } as never })
  const broker = new NodeBroker({ frame: () => {}, bytes: () => {}, status: () => {} })
  const from = performance.now()
  try {
    broker.upsert({ nodeId, label: 'synthetic', local: true, endpoint: `http://127.0.0.1:${port}`, token: 'synthetic-device-token' })
    for (const payload of outbox) broker.send(nodeId, JSON.parse(payload))
    const until = performance.now() + 3_000
    while (detaches < 1_000) {
      if (performance.now() > until) throw new Error('bounded flush wait expired')
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }
    return { attaches, detaches, screenFactoryCalls, snapshots, replayWrites, screenDisposals, finalActiveSinks: activeSinks, elapsedMs: performance.now() - from, engine: 'actual TerminalDisplay with a synthetic screen factory, no headless emulator CPU' }
  } finally {
    broker.dispose()
    disposeWsHub(server)
    setStreamHandlers(null)
    display.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch, commit: 'f8e4b59c', synthetic: true }, pairedAttachDetachCycles: 1_000, queueFrames: outbox.length, queueUtf8Bytes: outbox.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0), firstFrame: JSON.parse(outbox[0]!), lastFrame: JSON.parse(outbox.at(-1)!), flushedToHub: await flushToHub() }, null, 2))
