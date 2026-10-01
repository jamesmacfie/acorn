import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const session = process.argv[2] ?? 'perf-baseline'
const manifest = JSON.parse(await readFile(resolve('.acorn/agent-dev', session, 'session.json'), 'utf8'))
if (manifest.status !== 'ready') throw new Error(`Session ${session} is not ready.`)
const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,time=,comm='], { encoding: 'utf8' })
  .trim().split('\n').map(row => {
    const [, pid, parent, rss, cpu, cpuTime, command] = row.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/) ?? []
    return { pid: Number(pid), parent: Number(parent), rssKiB: Number(rss), cpuPercent: Number(cpu), cpuTime, command }
  })
const descendants = new Set([manifest.appPid])
let previousSize
do {
  previousSize = descendants.size
  for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid)
} while (previousSize !== descendants.size)
console.log(JSON.stringify({
  at: new Date().toISOString(),
  session,
  note: 'RSS includes shared pages. WebKit processes outside the app subtree are excluded.',
  processes: rows.filter(row => descendants.has(row.pid))
}, null, 2))
