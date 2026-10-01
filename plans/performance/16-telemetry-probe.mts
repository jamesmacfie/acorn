import { writeFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { MessageChannel } from 'node:worker_threads'
import { setImmediate as immediate } from 'node:timers/promises'
import * as node from '../../packages/node-core/src/server/telemetry/collector.ts'
import * as client from '../../packages/client-core/src/infra/telemetry/emitter.ts'
import { telemetryQueue } from '../../packages/client-core/src/infra/telemetry/queue.ts'
import { PluginRpcEndpoint } from '../../packages/node-core/src/server/plugins/pluginRpc.ts'
const tag = process.env.ACORN_PERF_TAG ?? 'sample'; const output = `plans/performance/16-telemetry-${tag}.json`
if (tag.startsWith('before') && existsSync(output)) throw new Error('Before exists')
if (node.PERF) throw new Error('ACORN_PERF must be unset to measure off')
const cpu = (run: () => void) => { const at = performance.now(), from = process.cpuUsage(); run(); const cost = process.cpuUsage(from); return { wallMs: performance.now() - at, cpuMs: (cost.user + cost.system) / 1000 } }
const collect = async () => { if (!global.gc) throw new Error('needs --expose-gc'); for (let i = 0; i < 5; i++) { await immediate(); global.gc() } return process.memoryUsage().heapUsed }
const result: any = { fixture: 'Actual Node/client emitters, queue and RPC endpoints in one isolate; isolated synthetic sinks/posters; no Sentry network. CPU measured operations, not app latency.', node: process.version }
node.resetTelemetryForTest(); const nodeBatches: any[] = []; const sink = node.onTelemetryBatch((batch) => nodeBatches.push(batch)); node.setTelemetryPref(false)
let sum = 0
result.nodeOff = cpu(() => { for (let i = 0; i < 100_000; i++) sum += node.measure('audit', 'bounded-seam', () => 1) })
node.setTelemetryPref(true); result.nodeOn = cpu(() => { for (let i = 0; i < 100_000; i++) sum += node.measure('audit', 'bounded-seam', () => 1) }); result.nodeFlush = cpu(node.flushTelemetry); result.nodeHistogram = nodeBatches.flatMap((b) => b.records).find((r) => r.name === 'bounded-seam')
nodeBatches.length = 0; for (let i = 0; i < 1000; i++) node.recordDuration('audit', `dynamic-${i}`, 1); node.flushTelemetry(); result.nodeDynamicSeries = nodeBatches.flatMap((b) => b.records).filter((r) => r.type === 'histogram').length
sink.dispose(); node.resetTelemetryForTest()
const clientBatches: any[] = []; client._resetClientTelemetry(); client.startClientTelemetry({ runtime: 'tui', post: async (records) => { clientBatches.push([...records]) } })
result.clientOff = cpu(() => { for (let i = 0; i < 100_000; i++) sum += client.measure('audit', 'bounded-seam', () => 1) }); client.setTelemetryEnabled(true)
result.clientOn = cpu(() => { for (let i = 0; i < 100_000; i++) sum += client.measure('audit', 'bounded-seam', () => 1) }); await client.flushTelemetry(); result.clientHistogram = clientBatches.flat().find((r) => r.name === 'bounded-seam')
clientBatches.length = 0; for (let i = 0; i < 1000; i++) client.recordDuration('audit', `dynamic-${i}`, 1); await client.flushTelemetry(); result.clientDynamicSeriesExported = clientBatches.flat().filter((r) => r.type === 'histogram').length; result.clientDynamicDropped = clientBatches.flat().find((r) => r.name === 'telemetry.dropped')?.value
client._resetClientTelemetry()
const queue = telemetryQueue(); const record = { kind: 'event', at: 1, name: 'synthetic', attrs: {} } as const
result.fullQueuePush100k = cpu(() => { for (let i = 0; i < 100_000; i++) queue.push(record) }); result.queue = { retained: queue.size(), dropped: queue.takeDropped() }
// RPC API fixture: compiled agents/workflows call Node telemetry directly. No first-party loaded
// Node plugin currently exercises startSpan/measure across this endpoint boundary.
const { port1, port2 } = new MessageChannel(); const host = new PluginRpcEndpoint(port1, () => 'async'), peer = new PluginRpcEndpoint(port2, () => 'async')
let hostFunctionEncodes = 0, peerFunctionEncodes = 0
for (const [endpoint, count] of [[host, () => hostFunctionEncodes++], [peer, () => peerFunctionEncodes++]] as const) { const original = endpoint.encode.bind(endpoint); endpoint.encode = async function(value, ...args) { if (typeof value === 'function') count(); return original(value, ...args) } }
const remote: any = peer.decode(await host.encode(node.telemetryFor('audit'))); const samples: any[] = []
const fn = () => 42
for (let i = 0; i < 10_000; i++) { await (await remote.startSpan('api-only')).end(); await remote.measure('api-only', fn); if (i === 999 || i === 4999 || i === 9999) samples.push({ calls: i + 1, hostFunctionEncodes, peerFunctionEncodes, heapBytes: await collect() }) }
host.close(new Error('done')); peer.close(new Error('done')); result.rpcTelemetryApi = { collecting: false, samples, heapAfterClose: await collect(), repeatedSameVisitorFunction: true }
result.checksum = sum; writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
