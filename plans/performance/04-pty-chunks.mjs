// Replay: rtk proxy node --import tsx plans/performance/04-pty-chunks.mjs
// Four disposable /tmp children, each exiting itself after 250 synthetic writes at 2 ms intervals.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { OutputRing } from '../../plugins/terminal/src/server/terminalUtils.ts'
const require = createRequire(new URL('../../plugins/terminal/package.json', import.meta.url))
const { spawn } = require('node-pty')
const results = []
for (const requestedChunkBytes of [8, 64, 256, 4096]) {
  const counts = new Map()
  const ring = new OutputRing()
  const code = `let n=0; const t=setInterval(()=>{process.stdout.write('x'.repeat(${requestedChunkBytes})); if(++n===250){clearInterval(t);process.stdout.end()}},2)`
  const pty = spawn(process.execPath, ['-e', code], { cols: 80, rows: 24, cwd: '/tmp', env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' } })
  const timeout = setTimeout(() => pty.kill(), 10000)
  pty.onData((data) => { const bytes = Buffer.byteLength(data); counts.set(bytes, (counts.get(bytes) ?? 0) + 1); ring.push(data) })
  const exit = await new Promise((resolve) => pty.onExit(resolve))
  clearTimeout(timeout)
  results.push({ requestedChunkBytes, writes: 250, ptyCallbacks: [...counts.values()].reduce((a, b) => a + b, 0),
    distribution: Object.fromEntries([...counts].sort(([a], [b]) => a - b)), ringBytes: ring.bytes, ringChunks: ring.chunks?.length ?? null, exitCode: exit.exitCode })
}
const json = JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch }, results }, null, 2) + '\n'
const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.slice('--tag='.length)
if (tag) {
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use an alphanumeric tag.')
  writeFileSync(new URL(`./04-pty-results-${tag}.json`, import.meta.url), json)
}
console.log(json)
