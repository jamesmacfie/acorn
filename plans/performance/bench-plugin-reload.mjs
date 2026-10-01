import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isolateNodePlugin } from '../../packages/node-core/src/server/plugins/isolation.ts';
import { initPlugins } from '../../packages/node-core/src/server/pluginHost/host.ts';
import { CapabilityRegistry } from '../../packages/node-core/src/server/pluginHost/capabilities.ts';
const root = mkdtempSync(join(tmpdir(),'acorn-area02-reload-'));
const permissions = {core:[],capabilities:[],secrets:false,exec:false,net:[],sockets:false};
const binding = {permissions, storage:{open(){throw new Error('No database in this fixture')}}};
const candidates=[];
const counts=[];
const workers=()=>process.report.getReport().workers.length;
try {
  const dir=join(root,'candidate'); mkdirSync(dir);
  const entrypoint=join(dir,'node.mjs');
  writeFileSync(entrypoint,"export default { name: 'candidate', init(ctx) { ctx.capabilities.provide('candidate.test',{}); ctx.capabilities.provide('candidate.test',{}); } };\n");
  const host=await initPlugins([{name:'candidate',init(){}}],{capabilities:new CapabilityRegistry(),core:{},dataDir:root,loaded:new Map([['candidate',binding]])});
  counts.push({phase:'baseline',workers:workers()});
  for(let i=1;i<=3;i++) {
    const plugin=await isolateNodePlugin({entrypoint,pluginDir:dir,plugin:'candidate',dataRoot:root,migrationsFolder:null,permissions});
    candidates.push(plugin);
    const outcome=await host.reload('candidate',{plugin,binding});
    await delay(50);
    counts.push({phase:'rejected reload '+i,outcome,workers:workers()});
  }
  await host.dispose(); await delay(50);
  counts.push({phase:'host disposed',workers:workers()});
  for (const plugin of candidates) await plugin.dispose();
  await delay(100);
  counts.push({phase:'manual candidate dispose',workers:workers()});
  console.log(JSON.stringify({counts}));
} finally {rmSync(root,{recursive:true,force:true});}
