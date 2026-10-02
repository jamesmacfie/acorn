import assert from 'node:assert/strict'
import { createConnection } from 'node:net'
import { existsSync, writeFileSync } from 'node:fs'
import { PreviewTunnels } from '../../packages/custody/src/supervision/previewTunnel.ts'

const tag = process.argv[2] ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const destination = new URL(`13-tunnels-${tag}.json`, import.meta.url)
if (/(?:^|-)before(?:-|$)/.test(tag) && existsSync(destination)) throw new Error('Before evidence exists; use another tag.')
const output = { runtime: process.version, note: 'Actual loopback listener ownership; no remote Node or preview page is dialled.', records: [] }
const retiredPorts = []
const closedPort = port => new Promise(done => {
  const socket = createConnection({ host: '127.0.0.1', port })
  socket.once('connect', () => { socket.destroy(); done(false) })
  socket.once('error', () => { socket.destroy(); done(true) })
})
const resolve = () => ({ endpoint: 'https://127.0.0.1:1', token: 'synthetic-token' })
const target = { nodeId: 'synthetic-node', taskId: 'synthetic-task', port: 3000 }

{
  const owner = new PreviewTunnels(resolve)
  try {
    const results = await Promise.allSettled(Array.from({ length: 24 }, (_, index) => owner.open({ ...target, taskId: `synthetic-${index}` })))
    const ports = results.filter(result => result.status === 'fulfilled').map(result => result.value)
    retiredPorts.push(...ports)
    assert.equal(ports.length, 16)
    output.records.push({ name: 'concurrent-cap', requests: results.length, openedListeners: new Set(ports).size,
      rejected: results.filter(result => result.status === 'rejected').length,
      ownPortsWithHeaders: ports.filter(port => owner.headersFor(`http://127.0.0.1:${port}/`)).length })
  } finally { owner.dispose() }
}
for (const action of ['close-task', 'dispose']) {
  let published = 0
  const owner = new PreviewTunnels(resolve, { opened: () => { published++ }, closed: () => {} })
  try {
    const opening = owner.open(target)
    if (action === 'close-task') owner.closeFor({ nodeId: target.nodeId, taskId: target.taskId })
    else owner.dispose()
    const result = await opening.then(() => 'opened', () => 'retired')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(result, 'retired')
    assert.equal(published, 0)
    output.records.push({ name: `pending-${action}`, listenerAliveAfterClose: false, published, result })
  } finally { owner.dispose() }
}
{
  const owner = new PreviewTunnels(resolve)
  try {
    const ports = await Promise.all(Array.from({ length: 8 }, () => owner.open(target)))
    retiredPorts.push(...new Set(ports))
    assert.equal(new Set(ports).size, 1)
    output.records.push({ name: 'same-key-dedupe', requests: 8, openedListeners: new Set(ports).size })
  } finally { owner.dispose() }
}
await new Promise(resolve => setImmediate(resolve))
assert.ok((await Promise.all(retiredPorts.map(closedPort))).every(Boolean))
output.retiredPublishedPorts = retiredPorts.length
output.allPublishedPortsClosed = true
writeFileSync(destination, JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify(output, null, 2))
