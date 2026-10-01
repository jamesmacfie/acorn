// Paired owner probe. The original bench-node-rpc.mjs and its evidence remain unchanged.
import { MessageChannel } from 'node:worker_threads';
import { setImmediate as immediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const sourceRoot = resolve(process.env.ACORN_PERF_SOURCE_ROOT ?? '.');
const tag = process.env.ACORN_PERF_TAG ?? 'sample';
const output = `plans/performance/evidence/node-rpc-${tag}.json`;
if (existsSync(output)) throw new Error(`Evidence already exists: ${output}`);
const { PluginRpcEndpoint } = await import(pathToFileURL(join(sourceRoot, 'packages/node-core/src/server/plugins/pluginRpc.ts')).href);
const { buildPluginRequestContext } = await import(pathToFileURL(join(sourceRoot, 'packages/node-core/src/server/pluginHost/requestContext.ts')).href);
const telemetry = await import(pathToFileURL(join(sourceRoot, 'packages/node-core/src/server/telemetry/collector.ts')).href);
const collect = async () => { if (!global.gc) throw new Error('needs --expose-gc'); for (let i = 0; i < 5; i++) { await immediate(); global.gc(); } return process.memoryUsage().heapUsed; };
const counts = endpoint => endpoint.referenceCounts?.() ?? null;
let frames;
const pair = () => { const { port1, port2 } = new MessageChannel(); frames = {}; const ownedFrames = frames; for (const port of [port1, port2]) { const post = port.postMessage.bind(port); port.postMessage = message => { const kind = message?.__acornRpc ?? 'other'; ownedFrames[kind] = (ownedFrames[kind] ?? 0) + 1; post(message); }; } return [new PluginRpcEndpoint(port1, () => 'async'), new PluginRpcEndpoint(port2, () => 'async')]; };
const result = { sourceRoot, node: process.version, fixture: 'Actual selected source RPC and request-context owners, two endpoints in one isolate, forced GC. Elapsed/CPU excludes sample GC. No provider/network calls.', routes: [], bodies: [], spans: [] };
let [host, peer] = pair(), hostFunctionEncodes = 0, peerFunctionEncodes = 0, weakPrincipal;
for (const [endpoint, count] of [[host, () => hostFunctionEncodes++], [peer, () => peerFunctionEncodes++]]) { const encode = endpoint.encode.bind(endpoint); endpoint.encode = async function(value, ...args) { if (typeof value === 'function') count(); return encode(value, ...args); }; }
const remote = host.decode(await peer.encode({ route: async () => Response.json({ ok: true }), signal: async (request, explicit) => ({ requestAborted: request.signal.aborted, explicitAborted: explicit.aborted }), body: async request => new Response(await request.arrayBuffer()) }));
const env = { DB: {}, SECRETS: {} };
let completed = 0;
for (const batch of [1000, 10000, 10000]) {
  const at = performance.now(), from = process.cpuUsage();
  for (let i = 0; i < batch; i++) {
    let principal = { kind: 'device', userId: 'owner', deviceId: `measurement-${completed}` };
    if (completed === 1000) weakPrincipal = new WeakRef(principal);
    await remote.route(new Request('https://localhost/noop'), buildPluginRequestContext(env, principal, 'linear'));
    principal = null; completed++;
  }
  const usage = process.cpuUsage(from), wallMs = performance.now() - at;
  result.routes.push({ calls: completed, batch, wallMs, cpuMs: (usage.user + usage.system) / 1000, hostFunctionEncodes, peerFunctionEncodes, heapBytes: await collect(), host: counts(host), peer: counts(peer), frames: { ...frames } });
}
result.retainedBeforeClose = weakPrincipal.deref() !== undefined;
const controller = new AbortController(); controller.abort('measurement');
result.abortResult = await remote.signal(new Request('https://localhost/abort', { signal: controller.signal }), controller.signal);
host.close(new Error('done')); peer.close(new Error('done'));
result.routesHeapAfterClose = await collect(); result.retainedAfterClose = weakPrincipal.deref() !== undefined;
[host, peer] = pair();
const body = host.decode(await peer.encode(async request => new Response(await request.arrayBuffer())));
completed = 0;
for (const batch of [1000, 4000, 5000]) {
  const at = performance.now(), from = process.cpuUsage();
  for (let i = 0; i < batch; i++) {
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(512)); c.enqueue(new Uint8Array(512)); c.close(); } });
    const response = await body(new Request('https://localhost/body', { method: 'POST', body: stream, duplex: 'half' }));
    await response.arrayBuffer(); completed++;
  }
  const usage = process.cpuUsage(from), wallMs = performance.now() - at;
  result.bodies.push({ calls: completed, batch, wallMs, cpuMs: (usage.user + usage.system) / 1000, heapBytes: await collect(), host: counts(host), peer: counts(peer), frames: { ...frames } });
}
host.close(new Error('done')); peer.close(new Error('done')); result.bodiesHeapAfterClose = await collect();
telemetry.resetTelemetryForTest();
[host, peer] = pair();
// Anchor to the actual published init-context path. Method names on arbitrary capabilities carry
// no lifetime policy. Modes remain async on both selected sources, as in the original area-16 probe.
const api = peer.decode(await host.encode({ telemetry: telemetry.telemetryFor('audit') }, 'plugin.init.args[0]')).telemetry;
const visitor = () => 42; completed = 0;
for (const batch of [1000, 4000, 5000]) {
  const at = performance.now(), from = process.cpuUsage();
  for (let i = 0; i < batch; i++) { const span = await api.startSpan('api-only'); await span.end(); await span.end(); await api.measure('api-only', visitor); completed++; }
  const usage = process.cpuUsage(from), wallMs = performance.now() - at;
  result.spans.push({ calls: completed, batch, wallMs, cpuMs: (usage.user + usage.system) / 1000, heapBytes: await collect(), host: counts(host), peer: counts(peer), frames: { ...frames } });
}
host.close(new Error('done')); peer.close(new Error('done')); result.spansHeapAfterClose = await collect(); telemetry.resetTelemetryForTest();
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, sourceRoot, routes: result.routes, bodies: result.bodies, spans: result.spans, retainedBeforeClose: result.retainedBeforeClose, abortResult: result.abortResult }));
