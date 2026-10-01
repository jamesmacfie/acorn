import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHelperServer } from '../../apps/desktop/src/helper/helperServer.ts'
import { NodeBroker } from '../../packages/custody/src/broker/nodeBroker.ts'
import { attachWsHub, disposeWsHub, setStreamHandlers, registerWsChannelHandler } from '../../packages/node-core/src/server/transport/wsHub.ts'
import { registerDockerWsChannel } from '../../plugins/docker/src/server/wsChannel.ts'
import { getDockerService, disposeDocker } from '../../plugins/docker/src/server/dockerService.ts'
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url)); const { WebSocket } = require('ws')
const tag = process.env.ACORN_PERF_TAG ?? 'sample'; const output = `plans/performance/16-shared-viewers-${tag}.json`
if (tag.startsWith('before') && existsSync(output)) throw new Error('Before exists')
const NODE = '00000000-0000-4000-8000-000000000001', SESSION = '00000000-0000-4000-8000-000000000003'
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const waitFor = async (check: () => boolean) => { const until = Date.now() + 3_000; while (!check()) { if (Date.now() > until) throw new Error('bounded wait expired'); await delay(5) } }
const dir = mkdtempSync(join(tmpdir(), 'acorn-perf-viewers-')); const oldPath = process.env.PATH
writeFileSync(join(dir, 'docker'), `#!${process.execPath}\nlet n=0; console.log('synthetic-line-'+(++n)); setInterval(()=>console.log('synthetic-line-'+(++n)),15)\n`); chmodSync(join(dir, 'docker'), 0o755); process.env.PATH = dir
let server: any, helper: any, broker: any; const viewers: any[] = []; let termAttaches = 0, termDetaches = 0, streamOpens = 0, streamStops = 0, upstreamDockerFrames = 0; const sinks = new Set<any>(); const checkpoints: any[] = []
try {
  server = createServer((_req, response) => response.end(JSON.stringify({ baseline: 'acorn-1', protocolVersion: 1, fingerprint: 'synthetic' }))); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port
  setStreamHandlers({ input() {}, attach(_id, sink) { termAttaches++; sinks.add(sink); sink({ type: 'ready', session: { id: SESSION }, replayed: true }); sink({ type: 'output', data: 'SCREEN' }) }, detach(_id, sink) { termDetaches++; sinks.delete(sink) }, streamTaskId: () => 'synthetic-task' })
  attachWsHub(server, { internalToken: 'synthetic', allowedHosts: new Set([`127.0.0.1:${port}`]), devices: { authenticate: async (token: string) => token === 'synthetic-device-token' ? { deviceId: 'synthetic-device' } : null, onRevoked: () => () => {}, isActive: async () => true } as any })
  const service = getDockerService(); const open = service.openStream.bind(service)
  service.openStream = (...args) => { streamOpens++; const handle = open(...args); let stopped = false; return { stop() { if (!stopped) { stopped = true; streamStops++ } handle.stop() } } }
  registerDockerWsChannel({ send() {}, channel: registerWsChannelHandler } as any)
  broker = new NodeBroker({ frame: (nodeId, frame: any) => { if (frame.channel === 'docker:log') upstreamDockerFrames++; helper?.push({ push: 'node-frame', nodeId, frame }) }, bytes: (nodeId, frame) => helper?.pushBytes(nodeId, frame), status() {} })
  helper = await startHelperServer({ broker, fleet: { list: () => [] } } as any, { secret: 'synthetic-viewer-secret', appOrigin: 'http://acorn.localhost' })
  broker.upsert({ nodeId: NODE, label: 'synthetic', endpoint: `http://127.0.0.1:${port}`, local: true, token: 'synthetic-device-token' }); await waitFor(() => broker.statuses()[0]?.state === 'online')
  const viewer = async () => { const ws = new WebSocket(`ws://127.0.0.1:${helper.port}/helper?secret=${helper.secret}`); await once(ws, 'open'); const messages: any[] = []; ws.on('message', (data: any, binary: boolean) => messages.push(binary ? { binary: true } : JSON.parse(String(data)))); let id = 0; const call = (frame: any) => new Promise<void>((resolve) => { const wanted = ++id; const listener = (data: any, binary: boolean) => { if (binary) return; const msg = JSON.parse(String(data)); if (msg.id === wanted) { ws.off('message', listener); if (!msg.ok) throw new Error(msg.error); resolve() } }; ws.on('message', listener); ws.send(JSON.stringify({ id: wanted, method: 'node-send', params: { nodeId: NODE, frame } })) }); const value = { ws, messages, call }; viewers.push(value); return value }
  const a = await viewer(); let b: any
  const change = async (v: any, verb: 'attach' | 'detach') => { await v.call({ channel: `term:${verb}`, id: SESSION }); await v.call({ channel: `docker:logs:${verb}`, id: 'synthetic-container' }) }
  const rows = (v: any) => ({ binary: v.messages.filter((m: any) => m.binary).length, docker: v.messages.filter((m: any) => m.frame?.channel === 'docker:log').length, ready: v.messages.filter((m: any) => m.frame?.channel === 'term:out' && m.frame.msg.type === 'ready').length })
  const state = (phase: string) => checkpoints.push({ phase, termAttaches, termDetaches, termSinks: sinks.size, streamOpens, streamStops, upstreamDockerFrames, a: rows(a), b: rows(b) })
  await change(a, 'attach'); await waitFor(() => rows(a).ready === 1); b = await viewer(); await change(b, 'attach'); await waitFor(() => rows(b).docker >= 2); state('second authenticated renderer attaches after first restore through one authenticated NodeBroker socket')
  for (const sink of sinks) sink({ type: 'output', data: 'LIVE' }); await waitFor(() => rows(b).binary >= 1)
  await change(a, 'detach'); await waitFor(() => sinks.size === 0 && streamStops === 1); const atDetach = rows(b); await delay(80); state('A detached while B still attached'); checkpoints.push({ phase: 'B additional output in 80ms after A detach', binary: rows(b).binary - atDetach.binary, docker: rows(b).docker - atDetach.docker })
  await change(b, 'attach'); await change(a, 'attach'); await waitFor(() => sinks.size === 1 && rows(b).docker > atDetach.docker); a.ws.close(); await once(a.ws, 'close'); await delay(30); state('A disconnected while B still attached')
  b.ws.close(); await once(b.ws, 'close'); const noViewers = upstreamDockerFrames; await delay(50); state('last renderer disconnected'); checkpoints.push({ phase: 'upstream Docker output with zero renderer sockets for 50ms', frames: upstreamDockerFrames - noViewers })
  broker.dispose(); await waitFor(() => sinks.size === 0 && streamStops === 2); state('broker disposed, actual Node socket disconnect cleans both streams')
  writeFileSync(output, JSON.stringify({ fixture: 'Actual helperServer + NodeBroker + wsHub + Docker channel + DockerService. Device auth uses only synthetic token; Docker PATH is disposable synthetic executable; terminal engine represented by sink counters. No real Docker daemon or private profile.', checkpoints }, null, 2) + '\n')
} finally { for (const viewer of viewers) viewer.ws.terminate(); broker?.dispose(); await helper?.close(); disposeDocker(); registerWsChannelHandler('docker', null); if (server) { disposeWsHub(server); setStreamHandlers(null); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(resolve)) } process.env.PATH = oldPath; rmSync(dir, { recursive: true, force: true }) }
