import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
import { _resetWsClient } from '../../packages/client-core/src/infra/node/wsClient'
import { wsReattachFrames } from '../../packages/client-core/src/infra/node/wsChannels'
import { wsDockerAttach, _resetDockerWsChannel } from '../../plugins/docker/src/client/wsChannel'

it('records colliding Docker stream IDs across an actual active Node transition', () => {
  const sends: { nodeId: string; frame: unknown }[] = []
  let onFrame!: (nodeId: string, frame: unknown) => void
  Object.assign(window, { acorn: {
    nodeFetch: async () => ({ status: 200, headers: {}, body: new Uint8Array() }),
    nodeSend: (nodeId: string, frame: unknown) => sends.push({ nodeId, frame }),
    onNodeFrame: (callback: typeof onFrame) => { onFrame = callback; return () => {} },
    onNodeBytes: () => () => {}, onNodeStatus: () => () => {},
  } })
  _resetWsClient(); _resetDockerWsChannel(); setActiveNode('node-a')
  const received: unknown[] = []
  const detach = wsDockerAttach('logs', 'same-container', event => received.push(event))
  try {
    setActiveNode('node-b')
    const replay = wsReattachFrames().filter(frame => frame.channel.startsWith('docker:'))
    onFrame('node-b', { channel: 'docker:log', id: 'same-container', data: 'FROM B' })
    detach()
    const tag = process.env.ACORN_PERF_TAG ?? 'sample'
    const destination = join(dirname(fileURLToPath(import.meta.url)), `13-docker-scope-${tag}.json`)
    if (tag.startsWith('before') && existsSync(destination)) throw new Error('Use another before tag.')
    writeFileSync(destination, JSON.stringify({ owner: 'actual Docker ws channel, activeNode, wsClient, synthetic transport', sends,
      oldSubscriptionReplayedAfterSwitch: replay, oldSubscriptionReceivedNewNodeOutput: received,
      expected: 'A stream is keyed to its originating Node; departing cleanup addresses A, and B same-ID frames cannot feed A log history.' }, null, 2) + '\n')
    expect(received).toEqual([{ kind: 'log', data: 'FROM B' }])
    expect(sends.at(-1)?.nodeId).toBe('node-b')
  } finally {
    detach(); _resetDockerWsChannel(); _resetWsClient(); setActiveNode(null)
    delete (window as any).acorn
  }
})
