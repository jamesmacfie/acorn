// Select every changed owner from the requested checkout. The fixture never uses private profiles.
import { createServer, Agent } from 'node:http'
import { once } from 'node:events'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const root = resolve(process.env.ACORN_SOURCE_ROOT ?? process.cwd())
const after = process.env.ACORN_PERF_MODE === 'after'
const selected = (path: string) => import(pathToFileURL(join(root, path)).href)
const require = createRequire(join(root, 'apps/desktop/package.json'))
const { WebSocket } = require('ws')
const wsContract = await selected('packages/protocol/src/ws.ts')
const { decodeIdFrame } = wsContract
const hub = await selected('packages/node-core/src/server/transport/wsHub.ts')
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
const waitFor = async (predicate: () => boolean, budget = 6000) => {
  const until = performance.now() + budget
  while (!predicate()) { if (performance.now() > until) throw new Error('Bounded fixture wait expired'); await delay(5) }
}
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const SESSION = '00000000-0000-4000-8000-000000000003'

// wsHub is process-owned. Each fixture Node therefore lives in a separate child process.
if (process.argv.includes('--fixture-node')) {
  const { TerminalDisplay, HeadlessTerminalScreen } = await selected('plugins/terminal/src/server/terminalDisplay.ts')
  const { registerDockerWsChannel } = await selected('plugins/docker/src/server/wsChannel.ts')
  const { getDockerService, disposeDocker } = await selected('plugins/docker/src/server/dockerService.ts')
  const directory = mkdtempSync(join(tmpdir(), 'acorn-unit03-node-'))
  writeFileSync(join(directory, 'docker'), `#!${process.execPath}\nlet n=0; console.log('line-'+(++n)); setInterval(()=>console.log('line-'+(++n)),20)\n`)
  chmodSync(join(directory, 'docker'), 0o755)
  process.env.PATH = directory
  const counts = { attaches: 0, detaches: 0, sinks: 0, snapshots: 0, producers: 0, stops: 0, physicalSockets: 0 }
  let size = { cols: 80, rows: 24 }, ring = ''
  const display = new TerminalDisplay(80, 24, (cols: number, rows: number) => {
    const screen = new HeadlessTerminalScreen(cols, rows)
    return { write: (text: string) => screen.write(text), resize: (cols: number, rows: number) => screen.resize(cols, rows), dispose: () => screen.dispose(), snapshot: () => { counts.snapshots++; return screen.snapshot() } }
  })
  const pty = require('node-pty').spawn('/bin/sh', ['-c', 'stty -echo; cat'], { cwd: directory, cols: 80, rows: 24, env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' } })
  pty.onData((data: string) => { ring = (ring + data).slice(-512 * 1024); display.write(data); display.publish({ type: 'output', data }) })
  pty.write('ISOLATED-PTY-READY\n')
  await waitFor(() => ring.includes('ISOLATED-PTY-READY'))
  const server = createServer((request, response) => {
    if (request.url === '/v1/node') return response.end(JSON.stringify({ baseline: 'acorn-1', protocolVersion: 1, fingerprint: 'fixture', ...(after ? { eventTransport: { viewers: 1 } } : {}) }))
    if (request.headers.authorization !== 'Bearer synthetic-device') return response.writeHead(401).end()
    response.end('fixture-read')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as any).port
  const resize = (next: typeof size) => { size = next; display.resize(next.cols, next.rows); pty.resize(next.cols, next.rows) }
  hub.setStreamHandlers({ input: (_id: string, data: string) => pty.write(data), streamTaskId: () => 'fixture-task', flowControl: (_id: string, paused: boolean) => paused ? pty.pause() : pty.resume(),
    attach: (_id: string, sink: any, next: typeof size) => { counts.attaches++; counts.sinks++; if (next) resize(next); display.attach(sink, { id: SESSION, ...size }, () => ring) },
    detach: (_id: string, sink: any) => { counts.detaches++; counts.sinks--; display.detach(sink) },
  })
  hub.attachWsHub(server, { internalToken: 'fixture', allowedHosts: new Set([`127.0.0.1:${port}`]), devices: { authenticate: async (token: string) => token === 'synthetic-device' ? { deviceId: 'fixture-device' } : null, onRevoked: () => () => {}, isActive: async () => true } as any })
  const eventSockets = new Set<any>()
  server.on('upgrade', (_request, socket) => { counts.physicalSockets++; eventSockets.add(socket); socket.once('close', () => eventSockets.delete(socket)) })
  const service = getDockerService(), original = service.openStream.bind(service)
  service.openStream = (...args: any[]) => { counts.producers++; const handle = original(...args); let stopped = false; return { stop() { if (!stopped) { counts.stops++; stopped = true } handle.stop() } } }
  registerDockerWsChannel({ send() {}, channel: hub.registerWsChannelHandler })
  process.on('message', async (message: any) => {
    if (message.type === 'state') process.send?.({ id: message.id, ...counts, size, pids: [process.pid, pty.pid, ...[...service.streams].map((child: any) => child.pid), service.events?.pid].filter(Boolean) })
    if (message.type === 'drop') { for (const socket of eventSockets) socket.destroy(); process.send?.({ id: message.id }) }
    if (message.type === 'resize') { resize(message.size); process.send?.({ id: message.id }) }
    if (message.type === 'burst') {
      const cpu = process.cpuUsage(), at = performance.now()
      for (let i = 0; i < message.count; i++) { hub.wsBroadcast({ channel: 'tasks:changed', taskId: null }); display.publish({ type: 'output', data: 'x'.repeat(4096) }) }
      const usage = process.cpuUsage(cpu)
      process.send?.({ id: message.id, elapsedMs: performance.now() - at, processCpuMs: (usage.user + usage.system) / 1000 })
    }
    if (message.type === 'stop') {
      hub.disposeWsHub(server); hub.setStreamHandlers(null); disposeDocker(); display.dispose(); pty.kill(); server.closeAllConnections()
      server.close(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0) })
    }
  })
  process.send?.({ port })
} else {
  const { startHelperServer } = await selected('apps/desktop/src/helper/helperServer.ts')
  const { NodeBroker } = await selected('packages/custody/src/broker/nodeBroker.ts')
  const { nodeRequest } = await selected('packages/custody/src/broker/nodeRequest.ts')
  const encode = after ? (await selected('apps/desktop/src/helper/bodyCodec.ts')).encodeResponseBody : (await selected('apps/desktop/src/shell/wire.ts')).encodeBytes
  const tag = process.env.ACORN_PERF_TAG ?? (after ? 'after' : 'before')
  const output = new URL(`./evidence/transport-${tag}.json`, import.meta.url)
  if (existsSync(output)) throw new Error('Evidence output already exists')
  const children: any[] = [], renderers: any[] = [], ownedPids = new Set<number>()
  let result: any
  const startNode = async () => {
    const child = fork(fileURLToPath(import.meta.url), ['--fixture-node'], { cwd: root, execArgv: ['--import', require.resolve('tsx/esm')], env: { ...process.env, ACORN_SOURCE_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    children.push(child)
    ownedPids.add(child.pid!)
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    const port = await new Promise<number>((done, reject) => { const timeout = setTimeout(() => reject(new Error('Node fixture startup timed out')), 10000); child.once('message', (message: any) => { clearTimeout(timeout); done(message.port) }); child.once('exit', (code: number) => reject(new Error(`Node fixture exited ${code}`))) })
    let id = 0
    const ask = (message: object) => new Promise<any>((done, reject) => { const key = ++id; const timeout = setTimeout(() => reject(new Error('Node fixture IPC timed out')), 6000); const receive = (reply: any) => { if (reply.id === key) { for (const pid of reply.pids ?? []) ownedPids.add(pid); clearTimeout(timeout); child.off('message', receive); done(reply) } }; child.on('message', receive); child.send({ ...message, id: key }) })
    return { port, ask }
  }
  let helper: any, broker: any
  try {
    const nodeA = await startNode(), nodeB = await startNode()
    await nodeA.ask({ type: 'state' }); await nodeB.ask({ type: 'state' })
    console.error('Fixture Nodes ready')
    const upstream = { json: 0, binary: 0, binaryBytes: 0 }
    broker = new NodeBroker({ frame: (nodeId: string, frame: any, viewerId: string) => { upstream.json++; helper?.push({ push: 'node-frame', nodeId, frame }, viewerId) }, bytes: (nodeId: string, frame: Uint8Array, viewerId: string) => { upstream.binary++; upstream.binaryBytes += frame.byteLength; helper?.pushBytes(nodeId, frame, viewerId) }, status: (status: any) => helper?.push({ push: 'node-status', status }), transportError: (nodeId: string, error: any, viewerId: string) => helper?.push({ push: 'node-transport-error', nodeId, error }, viewerId) }, { viewerMultiplexing: true })
    helper = await startHelperServer({ broker, fleet: { list: () => [] } }, { secret: 'fixture-renderer-secret', appOrigin: 'http://acorn.localhost' })
    for (const [nodeId, port] of [[A, nodeA.port], [B, nodeB.port]]) broker.upsert({ nodeId, label: 'fixture', endpoint: `http://127.0.0.1:${port}`, local: true, token: 'synthetic-device' })
    await waitFor(() => broker.statuses().every((status: any) => status.state === 'online') && broker.statuses().length === 2)
    const openRenderer = async (nodeId: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${helper.port}/helper?secret=${helper.secret}`)
      const messages: any[] = [], ready: any[] = []; let binaryBytes = 0
      ws.on('message', (raw: any, binary: boolean) => {
        if (binary) { binaryBytes += raw.byteLength; const node = decodeIdFrame(raw); const term = node && decodeIdFrame(node.payload); messages.push({ binary: true, nodeId: node?.id, text: term && new TextDecoder().decode(term.payload) }); return }
        const msg = JSON.parse(String(raw)); messages.push(msg); if (msg.frame?.msg?.type === 'ready') ready.push(msg.frame.msg)
      })
      await once(ws, 'open')
      let id = 0
      const call = (method: string, params: any) => new Promise<any>((done, reject) => { const key = ++id; const timeout = setTimeout(() => reject(new Error(`Helper ${method} timed out`)), 6000); const receive = (raw: any, binary: boolean) => { if (binary) return; const response = JSON.parse(String(raw)); if (response.id === key) { clearTimeout(timeout); ws.off('message', receive); if (!response.ok) reject(new Error(response.error)); else done(response.value) } }; ws.on('message', receive); ws.send(JSON.stringify({ id: key, method, params })) })
      const value = { ws, messages, ready, call, bytes: () => binaryBytes }
      renderers.push(value)
      if (after) await call('node-interest', { nodeId })
      return value
    }
    const a = await openRenderer(A)
    const send = (viewer: any, channel: string, extra = {}) => viewer.call('node-send', { nodeId: A, frame: { channel, id: channel.startsWith('term:') ? SESSION : 'fixture-container', ...extra }, ...(after && /:(attach|detach)$/.test(channel) ? { intent: { key: channel.startsWith('term:') ? `term:${SESSION}` : 'docker:logs:fixture-container', state: channel.endsWith(':attach') ? 'attached' : 'detached' } } : {}) })
    await send(a, 'term:attach', { cols: 80, rows: 24 }); await send(a, 'docker:logs:attach')
    await waitFor(() => a.ready.length === 1 && a.messages.some((m: any) => m.binary && m.text?.includes('ISOLATED-PTY-READY')))
    const aSnapshots = a.messages.filter((m: any) => m.binary && m.text?.startsWith('\x1bc')).length
    const b = await openRenderer(A)
    await send(b, 'term:attach', { cols: 100, rows: 30 }); await send(b, 'docker:logs:attach')
    await delay(100)
    const joined = { node: await nodeA.ask({ type: 'state' }), aReady: a.ready.length, bReady: b.ready.length, aResetDelta: a.messages.filter((m: any) => m.binary && m.text?.startsWith('\x1bc')).length - aSnapshots }
    console.error('Viewer join measured')
    if (after && (joined.bReady !== 1 || joined.node.sinks !== 2 || joined.node.producers !== 1 || joined.aResetDelta !== 0)) throw new Error('Independent joining restore/sharing failed')
    await send(a, 'term:detach'); await send(a, 'docker:logs:detach')
    const bBefore = b.messages.length
    await nodeA.ask({ type: 'burst', count: 16 }); await delay(50)
    const surviving = { node: await nodeA.ask({ type: 'state' }), bAdditionalTerminalFrames: b.messages.slice(bBefore).filter((m: any) => m.binary).length }
    if (after && (surviving.node.sinks !== 1 || surviving.node.stops !== 0 || surviving.bAdditionalTerminalFrames !== 16)) throw new Error('Sibling survival failed')
    const fleet = await a.call('node-fetch', { nodeId: B, request: { requestId: 'fleet', path: '/v1/read' } })
    if (fleet.status !== 200) throw new Error('Fleet HTTP read failed')
    const atInactive = a.messages.length, bytesBefore = a.bytes(), cpu = process.cpuUsage(), at = performance.now()
    await nodeB.ask({ type: 'burst', count: 128 }); await delay(50)
    const usage = process.cpuUsage(cpu)
    const inactive = { downstreamFrames: a.messages.slice(atInactive).filter((m: any) => m.frame || m.binary).length, downstreamBytes: a.bytes() - bytesBefore, elapsedMs: performance.now() - at, parentProcessCpuMs: (usage.user + usage.system) / 1000 }
    if (after && inactive.downstreamFrames !== 0) throw new Error('Fleet read retargeted interest')
    // Update the typed attach intent before the existing HTTP size operation, as Terminal does.
    if (after) await send(b, 'term:attach', { cols: 144, rows: 44 })
    await nodeA.ask({ type: 'resize', size: { cols: 144, rows: 44 } })
    const beforeReconnect = await nodeA.ask({ type: 'state' }), readyBefore = b.ready.length
    console.error('Reconnect starting')
    await nodeA.ask({ type: 'drop' })
    await waitFor(() => broker.statuses().find((status: any) => status.nodeId === A)?.state === 'offline')
    if (!after) {
      await waitFor(() => broker.statuses().find((status: any) => status.nodeId === A)?.state === 'online')
      await send(b, 'term:attach') // Legacy renderer reattach deliberately omitted size.
    }
    await waitFor(() => b.ready.length > readyBefore)
    if (after) await send(b, 'term:attach', { cols: 144, rows: 44 }) // wsClient's online reattach
    await delay(50)
    const reconnect = { readyDelta: b.ready.length - readyBefore, latestSize: b.ready.at(-1)?.session, before: beforeReconnect, after: await nodeA.ask({ type: 'state' }) }
    if (after && (reconnect.readyDelta !== 1 || reconnect.latestSize.cols !== 144 || reconnect.after.snapshots - beforeReconnect.snapshots !== 1)) throw new Error('Resized reconnect did not restore once')
    a.ws.close(); await once(a.ws, 'close'); b.ws.close(); await once(b.ws, 'close'); await delay(75)
    const retired = await nodeA.ask({ type: 'state' })
    if (after && (retired.sinks !== 0 || retired.stops !== retired.producers)) throw new Error('Final renderer left resources')
    const bodies: any[] = []
    for (const byteLength of [65536, 2097152, 8388608]) {
      const backing = new Uint8Array(byteLength + 19).fill(65), bytes = backing.subarray(7, 7 + byteLength)
      const times: number[] = [], cpuTimes: number[] = []
      for (let i = 0; i < 9; i++) { const usageBefore = process.cpuUsage(), start = performance.now(); const result = encode(bytes); times.push(performance.now() - start); const used = process.cpuUsage(usageBefore); cpuTimes.push((used.user + used.system) / 1000); if (Buffer.from(result, 'base64').compare(Buffer.from(bytes)) !== 0) throw new Error('Body bytes mismatch') }
      bodies.push({ bytes: byteLength, base64Chars: 4 * Math.ceil(byteLength / 3), medianMs: times.toSorted((a, b) => a - b)[4], medianProcessCpuMs: cpuTimes.toSorted((a, b) => a - b)[4] })
    }
    const payload = Buffer.alloc(8388608, 71)
    const responseServer = createServer((_request, response) => { for (let i = 0; i < 128; i++) response.write(payload.subarray(i * 65536, (i + 1) * 65536)); response.end() })
    await new Promise<void>((done) => responseServer.listen(0, '127.0.0.1', done))
    const agent = new Agent({ keepAlive: true }), responseTimes: number[] = [], responseCpu: number[] = [], retained: Uint8Array[] = []
    for (let i = 0; i < 7; i++) { const cpuBefore = process.cpuUsage(), start = performance.now(); const response = await nodeRequest({ url: new URL(`http://127.0.0.1:${(responseServer.address() as any).port}/body`), method: 'GET', headers: {}, agent, signal: new AbortController().signal }); responseTimes.push(performance.now() - start); const used = process.cpuUsage(cpuBefore); responseCpu.push((used.user + used.system) / 1000); if (response.body.byteLength !== payload.length || response.body[0] !== 71 || response.body.at(-1) !== 71 || response.body.constructor !== Uint8Array) throw new Error('Response view mismatch'); retained.push(response.body) }
    agent.destroy(); responseServer.closeAllConnections(); await new Promise<void>((done) => responseServer.close(() => done()))
    const responseAssembly = { bytes: payload.length, fragmentedWrites: 128, retainedResponses: retained.length, retainedBytes: retained.reduce((sum, body) => sum + body.byteLength, 0), medianMs: responseTimes.toSorted((a, b) => a - b)[3], medianProcessCpuMs: responseCpu.toSorted((a, b) => a - b)[3], bodySizedAssemblyAllocationsPerResponse: after ? 1 : 2, allocationCountEvidence: 'Production owner source; timing includes HTTP, not an allocation profiler.' }
    const owners = ['apps/desktop/src/helper/helperServer.ts', 'packages/custody/src/broker/nodeBroker.ts', 'packages/custody/src/broker/nodeRequest.ts', 'packages/node-core/src/server/transport/wsHub.ts', 'plugins/docker/src/server/wsChannel.ts', 'plugins/terminal/src/server/terminalDisplay.ts', 'plugins/terminal/src/client/wsChannel.ts', 'plugins/terminal/src/client/terminalClient.ts', 'packages/protocol/src/ws.ts', 'packages/protocol/src/node.ts', after ? 'apps/desktop/src/helper/bodyCodec.ts' : 'apps/desktop/src/shell/wire.ts', ...(after ? ['apps/desktop/src/helper/rendererConnection.ts', 'packages/custody/src/broker/eventViewers.ts', 'packages/custody/src/broker/subscriptionOutbox.ts', 'packages/custody/src/broker/brokerFetch.ts', 'packages/node-core/src/server/transport/wsViewers.ts', 'packages/node-core/src/server/transport/wsViewerDispatch.ts', 'plugins/docker/src/server/sharedStreams.ts', 'plugins/docker/src/server/logReplay.ts'] : [])]
    const provenance = owners.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }))
    result = { sourceRoot: root, mode: after ? 'after' : 'before', node: process.version, provenance, fixture: 'Two separate authenticated wsHub Node child processes, real isolated node-pty cat and production xterm headless serialization, actual helper and broker, disposable Docker executable. No private state, real Docker daemon, Tauri, or visible latency measurement.', adaptations: after ? ['Explicit interest, advertised opt-in and typed intent; assert corrected independent viewer outcomes.'] : ['Legacy raw API; records known viewer sharing/zero-renderer defects without asserting corrected outcomes.'], joined, surviving, inactive, reconnect, retired, upstream, bodies, responseAssembly, limitations: ['Terminal engine adapter mirrors production attach/resize/display flow; uses actual PTY/emulator, not full plugin registration/database.', 'Base64 timing calls the selected production encoder; response timing includes loopback HTTP.', 'No heap-profiler or visible UI timing; structural allocation counts are labeled separately.', 'Opted-in binary adds a 36-byte viewer header per upstream targeted frame; helper preserves its existing 36-byte Node header. Dimension changes add one idempotent attach control frame.'] }
  } finally {
    for (const renderer of renderers) renderer.ws.terminate()
    broker?.dispose(); await helper?.close()
    for (const child of children) { if (child.connected) child.send({ type: 'stop' }); await Promise.race([once(child, 'exit'), delay(3000).then(() => child.kill('SIGKILL'))]) }
  }
  await delay(50)
  result.cleanup = [...ownedPids].map((pid) => { let alive = false; try { process.kill(pid, 0); alive = true } catch {} return { pid, alive } })
  if (result.cleanup.some((entry: any) => entry.alive)) throw new Error('Owned fixture process survived cleanup')
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ output: fileURLToPath(output), joined: result.joined, surviving: result.surviving, inactive: result.inactive, reconnect: result.reconnect, retired: result.retired, bodies: result.bodies, responseAssembly: result.responseAssembly, cleanup: result.cleanup }, null, 2))
}
