import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
const repo = process.cwd();
const root = fs.mkdtempSync('/tmp/acorn-startup-reconcile-');
const source = join(root, 'source');
const data = join(root, 'data');
const actualSource = process.argv[2];
let writes = 0, fsyncs = 0, reads = 0, readBytes = 0, fsyncMs = 0;
const oldWrite = fs.writeSync, oldFsync = fs.fsyncSync, oldRead = fs.readFileSync;
fs.writeSync = (...args) => { writes++; return oldWrite(...args); };
fs.fsyncSync = (...args) => { fsyncs++; const start = performance.now(); try { return oldFsync(...args); } finally { fsyncMs += performance.now() - start; } };
fs.readFileSync = (...args) => { const v = oldRead(...args); reads++; readBytes += Buffer.byteLength(v); return v; };
syncBuiltinESMExports();
const { reconcileBundledPlugins } = await import(`${repo}/packages/node-core/src/server/plugins/bundled.ts`);
const { PLUGIN_API_MAJOR } = await import(`${repo}/packages/node-core/src/server/plugins/manifest.ts`);
if (!actualSource) {
  for (let i=0;i<7;i++) {
    const dir = join(source, `plugin-${i}`);
    fs.mkdirSync(join(dir, 'dist'), {recursive:true});
    fs.writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({id:`plugin-${i}`,name:`Plugin ${i}`,version:'1.0.0',baseline:'acorn-1',apiVersion:PLUGIN_API_MAJOR,node:'./dist/node.js'}));
    fs.writeFileSync(join(dir, 'dist/node.js'), ' '.repeat(250000));
  }
}
const resource = actualSource ?? source;
const seed = reconcileBundledPlugins(data, resource);
const results=[];
for (let i=0;i<10;i++) {
  writes=0;fsyncs=0;reads=0;readBytes=0;fsyncMs=0;
  const start=performance.now(); const result=reconcileBundledPlugins(data,resource);
  results.push({ms:+(performance.now()-start).toFixed(2),writes,fsyncs,reads,readBytes,fsyncMs:+fsyncMs.toFixed(2),installed:result.installed.length,updated:result.updated.length,failed:result.failures.length});
}
console.log(JSON.stringify({source:actualSource ?? 'synthetic: 7 packages x 250KB',seed,results},null,2));
fs.rmSync(root,{recursive:true,force:true});
