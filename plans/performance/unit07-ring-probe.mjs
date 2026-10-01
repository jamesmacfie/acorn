import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
const [owner, sizeArg, output] = process.argv.slice(2)
const { OutputRing, RING_CAP } = await import(pathToFileURL(owner))
const size = Number(sizeArg), input = 'x'.repeat(size)
// One ring per process: earlier rings cannot contaminate retained backing-storage deltas.
global.gc(); const before = process.memoryUsage()
const ring = new OutputRing()
const begin = performance.now(), cpu = process.cpuUsage()
for(let i=0;i<RING_CAP;i+=size) ring.push(input)
const fillWallMs=performance.now()-begin, used=process.cpuUsage(cpu)
global.gc(); const held=process.memoryUsage()
const n=Math.min(8192,32768/size), overflowBegin=performance.now(), overflowCpu=process.cpuUsage()
for(let i=0;i<n;i++) ring.push(input)
const overflowWallMs=performance.now()-overflowBegin, over=process.cpuUsage(overflowCpu)
const result={ownerSha256:createHash('sha256').update(readFileSync(owner)).digest('hex'),node:process.version,size,bytes:ring.bytes,tailExact:ring.tail()==='x'.repeat(RING_CAP),fillWallMs,fillCpuMs:(used.user+used.system)/1000,overflowChunks:n,overflowWallMs,overflowCpuMs:(over.user+over.system)/1000,heapDelta:held.heapUsed-before.heapUsed,arrayBuffersDelta:held.arrayBuffers-before.arrayBuffers}
writeFileSync(output, JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result))
