import { MessageChannel } from 'node:worker_threads';
import { setImmediate as immediate } from 'node:timers/promises';
import { PluginRpcEndpoint } from '../../packages/node-core/src/server/plugins/pluginRpc.ts';
import { buildPluginRequestContext } from '../../packages/node-core/src/server/pluginHost/requestContext.ts';
const collect = async () => { for (let i=0; i<5; i++) { await immediate(); global.gc(); } return process.memoryUsage().heapUsed; };
const { port1, port2 } = new MessageChannel();
const host = new PluginRpcEndpoint(port1, ()=>'async');
const peer = new PluginRpcEndpoint(port2, ()=>'async');
let hostFunctionEncodes = 0, peerFunctionEncodes = 0;
for (const [endpoint, count] of [[host, ()=>hostFunctionEncodes++], [peer, ()=>peerFunctionEncodes++]]) {
  const original = endpoint.encode.bind(endpoint);
  endpoint.encode = async function(value, ...args) { if(typeof value === 'function') count(); return original(value, ...args); };
}
const remote = host.decode(await peer.encode({ route: async (_request, _context)=>Response.json({ok:true}), signal: async (request, explicit)=>({requestAborted:request.signal.aborted, explicitAborted:explicit.aborted}) }));
const env = { DB: {}, SECRETS: {} };
let weakPrincipal;
for (let i=0;i<1000;i++) await remote.route(new Request('https://localhost/noop'), buildPluginRequestContext(env,{kind:'device',userId:'owner'},'linear'));
const baseline = await collect();
const samples = [{calls:1000, hostFunctionEncodes, peerFunctionEncodes, heapBytes:baseline}];
for (let i=1000;i<21000;i++) {
  let principal = {kind:'device',userId:'owner',deviceId:'measurement-'+i};
  if(i===1000) weakPrincipal = new WeakRef(principal);
  await remote.route(new Request('https://localhost/noop'),buildPluginRequestContext(env,principal,'linear'));
  principal = null;
  if(i===10999 || i===20999) samples.push({calls:i+1,hostFunctionEncodes,peerFunctionEncodes,heapBytes:await collect()});
}
const retainedBeforeClose = weakPrincipal.deref()!==undefined;
const controller = new AbortController(); controller.abort('measurement');
const abortResult = await remote.signal(new Request('https://localhost/abort',{signal:controller.signal}),controller.signal);
host.close(new Error('done')); peer.close(new Error('done'));
const afterClose = await collect();
console.log(JSON.stringify({measurement:'actual RPC + actual buildPluginRequestContext; two endpoints same isolate; forced GC',samples,retainedBeforeClose,retainedAfterClose:weakPrincipal.deref()!==undefined,afterCloseHeapBytes:afterClose,abortResult}));
