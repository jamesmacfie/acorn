// Run: rtk proxy node --expose-gc --import tsx plans/performance/bench-client-remote-handlers.mjs [output.json]
// Exercises shipped remoteRoot APIs; captures synthetic arrays, never application data.
const { createRemoteRoot, createNode, insertNode, removeNode, setProperty } = await import(process.env.ACORN_PERF_REMOTE_ROOT ?? '../../packages/client-core/src/host/frames/remoteRoot.ts')
import { writeFileSync } from 'node:fs'

if (!global.gc) throw new Error('run with --expose-gc')
const turn = () => new Promise((resolve) => setImmediate(resolve))
const collect = async () => { await turn(); global.gc(); await turn(); global.gc() }
const result = { benchmark: 'remoteRoot handler ownership', node: process.version, cases: [] }
for (const mode of ['removed-node', 'replaced-handler']) {
  const refs = []
  const ids = []
  let events = 0
  const root = createRemoteRoot((ops) => {
    for (const op of ops) {
      const handler = op.op === 'insert' ? op.node.props.onPress?.$handler : op.op === 'patch' ? op.props.onPress?.$handler : undefined
      if (handler) ids.push(handler)
    }
  })
  await collect()
  const before = process.memoryUsage().heapUsed
  let single = mode === 'replaced-handler' ? createNode('Button') : null
  if (single) { insertNode(root.node, single); await turn() }
  const checkpoints = []
  for (let i = 0; i < 10000; i++) {
    const payload = new Array(512).fill(i)
    refs.push(new WeakRef(payload))
    const node = single ?? createNode('Button')
    setProperty(node, 'onPress', () => { events += payload[0] === i ? 1 : 0 })
    if (!single) insertNode(root.node, node)
    await turn()
    if (!single) { removeNode(root.node, node); await turn() }
    if ([999, 4999, 9999].includes(i)) {
      await collect()
      checkpoints.push({ changes: i + 1, retainedSyntheticPayloads: refs.filter((ref) => ref.deref()).length, heapGrowthBytes: process.memoryUsage().heapUsed - before })
    }
  }
  // Events addressed to a removed/replaced handler still call it before root disposal.
  root.dispatch(ids[0], null)
  const oldHandlerStillDispatches = events === 1
  root.dispose()
  if (single) { removeNode(root.node, single); single = null }
  await collect()
  result.cases.push({ mode, checkpoints, oldHandlerStillDispatches, retainedPayloadsAfterDispose: refs.filter((ref) => ref.deref()).length, heapGrowthBytesAfterDispose: process.memoryUsage().heapUsed - before })
}
writeFileSync(process.argv[2] ?? 'plans/performance/evidence/client-remote-handlers-sample.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(result, null, 2))
