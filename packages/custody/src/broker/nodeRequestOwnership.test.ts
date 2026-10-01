import { Agent, createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeRequest } from './nodeRequest'

const servers: Server[] = []
const agents: Agent[] = []
afterEach(() => { for (const agent of agents.splice(0)) agent.destroy(); for (const server of servers.splice(0)) server.close() })

describe('buffered Node response ownership', () => {
  it('returns precise plain byte views for zero, single, and fragmented bodies, retained across requests', async () => {
    const bytes = Buffer.from([0, 255, 1, 2, 128, 17])
    const server = createServer((request, response) => {
      if (request.url === '/empty') return response.end()
      if (request.url === '/single') return response.end(bytes)
      response.write(bytes.subarray(0, 2))
      setImmediate(() => { response.write(bytes.subarray(2, 5)); response.end(bytes.subarray(5)) })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const agent = new Agent({ keepAlive: true })
    agents.push(agent)
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const read = (path: string) => nodeRequest({ url: new URL(path, origin), method: 'GET', headers: {}, agent, signal: new AbortController().signal })
    const retained = (await read('/single')).body
    for (const path of ['/empty', '/single', '/fragmented']) {
      const response = await read(path)
      expect(response.body.constructor).toBe(Uint8Array)
      expect([...response.body]).toEqual(path === '/empty' ? [] : [...bytes])
    }
    expect([...retained]).toEqual([...bytes])
  })

  it('checks pre-abort before accessing a body for encoding', async () => {
    let reads = 0
    const body = { kind: 'bytes' as const, get bytes() { reads += 1; return new Uint8Array([1, 2]) } }
    const agent = new Agent()
    agents.push(agent)
    await expect(nodeRequest({ url: new URL('http://127.0.0.1:1/no-send'), method: 'POST', headers: {}, body, agent, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads).toBe(0)
  })
})
