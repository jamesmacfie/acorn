import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const [owner, output] = process.argv.slice(2)
const { AgentSender } = await import(pathToFileURL(owner))
const timers = new Set(), writes = []
const session = { write: text => writes.push(text), running: () => true, idle: () => false }
const sender = new AgentSender(() => session, 150, (run, ms) => {
  const timer = setTimeout(() => { timers.delete(timer); run() }, ms)
  timers.add(timer)
  return () => { clearTimeout(timer); timers.delete(timer) }
})
sender.send('fixture', 'synthetic', 'now')
const scheduled = timers.size
sender.clear('fixture')
const afterClear = timers.size
await new Promise(yes => setTimeout(yes, 175))
const result = { ownerSha256: createHash('sha256').update(readFileSync(owner)).digest('hex'), scheduled, afterClear, afterDeadline: timers.size, writes }
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
console.log(result)
