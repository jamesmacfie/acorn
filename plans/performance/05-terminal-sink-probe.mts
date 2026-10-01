// Adapted unit07 fixture: active renderer viewer retirement belongs to unit03. Never wait for
// forwarded inactive frames. Replay the captured actual channel sequence into broker/hub/display.
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { readFileSync, writeFileSync } from 'node:fs'
import { NodeBroker } from '../../packages/custody/src/broker/nodeBroker.ts'
import { attachWsHub, disposeWsHub, setStreamHandlers } from '../../packages/node-core/src/server/transport/wsHub.ts'
import { DISPLAY_RESET, TerminalDisplay } from '../../plugins/terminal/src/server/terminalDisplay.ts'
import { decodeIdFrame } from '../../packages/protocol/src/ws.ts'

const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const input = process.env.ACORN_PERF_FRAMES ?? '05-terminal-switch-unit05-clean-before.json'
const captured = JSON.parse(readFileSync(new URL(input, import.meta.url), 'utf8'))
const initial = captured.afterSwitch[0]
const nodeId = initial.nodeId
const sessionId = initial.frame.id
const main = '00000000-0000-4000-8000-000000000001'
const sibling = '00000000-0000-4000-8000-000000000002'
const results = []
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (condition: () => boolean) => {
  const deadline = performance.now() + 3000
  while (!condition()) { if (performance.now() > deadline) throw Error('bounded wait expired'); await pause(5) }
}
for (const modern of [false, true]) {
  const count = { attaches: 0, detaches: 0, activeSinks: 0, snapshots: 0, screenFactories: 0, screenDisposals: 0 }
  const frames: { viewer?: string; kind: string; bytes?: number; reset?: boolean }[] = []
  const display = new TerminalDisplay(80, 24, () => {
    count.screenFactories++
    return { write() {}, resize() {}, snapshot: async () => { count.snapshots++; return 'synthetic-screen' }, dispose: () => { count.screenDisposals++ } }
  })
  display.write('synthetic-history')
  const server = createServer((_request, response) => response.end(JSON.stringify({ baseline: 'acorn-1', protocolVersion: 1, fingerprint: 'synthetic', ...(modern ? { eventTransport: { viewers: 1 } } : {}) })))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  setStreamHandlers({ input() {}, streamTaskId: () => null,
    attach: (_id, sink) => { count.attaches++; count.activeSinks++; display.attach(sink as never, { id: sessionId } as never, () => 'synthetic-history') },
    detach: (_id, sink) => { count.detaches++; count.activeSinks--; display.detach(sink as never) },
  })
  attachWsHub(server, { internalToken: 'synthetic', allowedHosts: new Set([`127.0.0.1:${port}`]), devices: { authenticate: async () => ({ deviceId: 'synthetic-device' }), onRevoked: () => () => {}, isActive: async () => true } as never })
  const broker = new NodeBroker({ frame: (_id, frame, viewer) => { if (frame.channel === 'term:out') frames.push({ viewer, kind: (frame as any).msg.type }) },
    bytes: (_id, value, viewer) => { const tagged = decodeIdFrame(value); const text = tagged ? new TextDecoder().decode(tagged.payload) : ''; frames.push({ viewer, kind: 'output', bytes: value.byteLength, reset: text.startsWith(DISPLAY_RESET) }) }, status() {} }, { viewerMultiplexing: true })
  const send = (viewerId: string, frame: any, cleanup = false) => broker.send(nodeId, frame, { viewerId, cleanup, intent: { key: `term:${sessionId}`, state: frame.channel === 'term:detach' ? 'detached' : 'attached' } })
  try {
    broker.upsert({ nodeId, label: 'synthetic', local: true, endpoint: `http://127.0.0.1:${port}`, token: 'synthetic-device-token' })
    send(main, initial.frame)
    await until(() => frames.some(frame => frame.viewer === main && frame.reset === true) && !display.emulating)
    const initialAttach = { ...count, sequence: frames.filter(frame => frame.viewer === main).map(frame => ({ kind: frame.kind, reset: frame.reset })) }
    if (modern) { send(sibling, initial.frame); await until(() => frames.some(frame => frame.viewer === sibling && frame.reset === true)) }
    // Unit03 already retires the outgoing renderer's viewer before channel cleanup can run.
    broker.closeViewer(nodeId, main)
    await until(() => count.activeSinks === (modern ? 1 : 0))
    const cleanup = captured.afterSwitch.filter((entry: any) => entry.nodeId === nodeId && entry.frame.channel === 'term:detach')
      .map((entry: any) => ({ cleanup: entry.options?.cleanup === true, accepted: send(main, entry.frame, entry.options?.cleanup === true) }))
    const beforeOutput = frames.length
    const startCpu = process.cpuUsage()
    const start = performance.now()
    for (let index = 0; index < 128; index++) display.publish({ type: 'output', data: 'x'.repeat(4096) })
    if (modern) await until(() => frames.slice(beforeOutput).filter(frame => frame.viewer === sibling).length === 128)
    else await pause(40)
    const cpu = process.cpuUsage(startCpu)
    const inactive = { mainFrames: frames.slice(beforeOutput).filter(frame => frame.viewer === main).length, siblingFrames: frames.slice(beforeOutput).filter(frame => frame.viewer === sibling).length,
      siblingEncodedBytes: frames.slice(beforeOutput).filter(frame => frame.viewer === sibling).reduce((sum, frame) => sum + (frame.bytes ?? 0), 0),
      activeSinks: count.activeSinks, elapsedMs: performance.now() - start, processCpuMs: (cpu.user + cpu.system) / 1000 }
    const beforeReturn = { ...count }
    const returnAt = frames.length
    send(main, initial.frame)
    await until(() => frames.slice(returnAt).some(frame => frame.viewer === main && frame.reset === true) && !display.emulating)
    display.publish({ type: 'output', data: 'live-after-return' })
    await until(() => frames.slice(returnAt).filter(frame => frame.viewer === main).length === 3)
    const returned = { attaches: count.attaches - beforeReturn.attaches, snapshots: count.snapshots - beforeReturn.snapshots,
      sequence: frames.slice(returnAt).filter(frame => frame.viewer === main).map(frame => ({ kind: frame.kind, reset: frame.reset })), activeSinks: count.activeSinks }
    broker.closeViewer(nodeId, main); if (modern) broker.closeViewer(nodeId, sibling)
    await until(() => count.activeSinks === 0)
    if (inactive.mainFrames !== 0 || (modern && inactive.siblingFrames !== 128) || returned.snapshots !== 1) throw Error('viewer lifetime invariant failed')
    results.push({ modern, initialAttach, cleanup, inactive, returned, final: { ...count, emulating: display.emulating } })
  } finally {
    broker.dispose(); disposeWsHub(server); setStreamHandlers(null); display.dispose(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
const result = { fixture: 'actual captured channel frames replayed into NodeBroker, wsHub and TerminalDisplay; modern sibling + legacy Node; synthetic screen, no PTY/helper/WebKit; no inactive-forwarding gain attributed to unit05', input, environment: { node: process.version, platform: process.platform, arch: process.arch }, results }
writeFileSync(new URL(`05-terminal-sink-${tag}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
