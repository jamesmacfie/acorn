import { afterEach, expect, it, vi } from 'vitest'
import { setActiveNode, refreshFleet } from '@acorn/plugin-api/testkit/client'
import { managedAgentApi } from './managedClient'

const requests: { node: string; body: unknown }[] = []
const setup = async () => {
  requests.length = 0
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {},
    fleetList: async () => ({ nodes: ['upload-A', 'upload-B'].map(nodeId => ({ nodeId, endpoint: 'https://localhost', label: nodeId, local: true })), statuses: ['upload-A', 'upload-B'].map(nodeId => ({ nodeId, state: 'online' })) }),
    nodeFetch: async (node: string, request: { body?: unknown }) => {
      requests.push({ node, body: request.body })
      return { status: 200, headers: {}, body: new TextEncoder().encode('{"id":"uploaded"}') }
    },
  } })
  await refreshFleet()
  setActiveNode('upload-A')
}
afterEach(() => { setActiveNode(null); delete window.acorn; vi.restoreAllMocks() })

it('captures multipart origin before reading File bytes', async () => {
  await setup()
  let resolve!: (bytes: ArrayBuffer) => void
  const file = new File(['held'], 'held.txt', { type: 'text/plain' })
  vi.spyOn(file, 'arrayBuffer').mockReturnValue(new Promise(done => { resolve = done }))
  const uploaded = managedAgentApi.uploadAttachment('task', file)
  setActiveNode('upload-B')
  resolve(new Uint8Array([1, 2]).buffer)
  await uploaded
  expect(requests).toEqual([{ node: 'upload-A', body: { kind: 'form', parts: [
    { name: 'file', filename: 'held.txt', type: 'text/plain', bytes: new Uint8Array([1, 2]) },
  ] } }])
})

it('does not replace explicit null with the fleet Node after bytes resolve', async () => {
  await setup()
  await expect(managedAgentApi.uploadAttachment('task', new File(['x'], 'x.txt'), { nodeId: null })).rejects.toMatchObject({ code: 'no_active_node' })
  expect(requests).toEqual([])
})
