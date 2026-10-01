import { existsSync, writeFileSync } from 'node:fs'
import { PreviewTunnels } from '../../packages/custody/src/supervision/previewTunnel.ts'

const tag = process.argv[2] ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const destination = new URL(`13-tunnels-${tag}.json`, import.meta.url)
if (/(?:^|-)before(?:-|$)/.test(tag) && existsSync(destination)) throw new Error('Before evidence exists; use another tag.')
const output = { runtime: process.version, note: 'Actual loopback listener ownership; no remote Node or preview page is dialled.', records: [] }
const resolve = () => ({ endpoint: 'https://127.0.0.1:1', token: 'synthetic-token' })
const target = { nodeId: 'synthetic-node', taskId: 'synthetic-task', port: 3000 }

{
  const owner = new PreviewTunnels(resolve)
  try {
    const results = await Promise.allSettled(Array.from({ length: 24 }, (_, index) => owner.open({ ...target, taskId: `synthetic-${index}` })))
    const ports = results.filter(result => result.status === 'fulfilled').map(result => result.value)
    output.records.push({ name: 'concurrent-cap', requests: results.length, openedListeners: new Set(ports).size,
      rejected: results.filter(result => result.status === 'rejected').length,
      ownPortsWithHeaders: ports.filter(port => owner.headersFor(`http://127.0.0.1:${port}/`)).length })
  } finally { owner.dispose() }
}
for (const action of ['close-task', 'dispose']) {
  const owner = new PreviewTunnels(resolve)
  try {
    const opening = owner.open(target)
    if (action === 'close-task') owner.closeFor({ nodeId: target.nodeId, taskId: target.taskId })
    else owner.dispose()
    const port = await opening
    output.records.push({ name: `pending-${action}`, listenerAliveAfterClose: owner.headersFor(`http://127.0.0.1:${port}/`) !== null })
  } finally { owner.dispose() }
}
{
  const owner = new PreviewTunnels(resolve)
  try {
    const ports = await Promise.all(Array.from({ length: 8 }, () => owner.open(target)))
    output.records.push({ name: 'same-key-dedupe', requests: 8, openedListeners: new Set(ports).size })
  } finally { owner.dispose() }
}
writeFileSync(destination, JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify(output, null, 2))
